// Run:  npm i --no-save @electric-sql/pglite   then   node tests/cad-jobs.test.mjs
// Runs the real SQL of netlify/functions/cad-jobs.mjs on a real Postgres engine (PGlite) with an in-memory Blobs store.
import { PGlite } from "@electric-sql/pglite";
import handler, { makeDb, MAX_FAILS } from "../netlify/functions/cad-jobs.mjs";

const pg = new PGlite();
const sql = async (strings, ...vals) => (await pg.query(strings.reduce((a, s, i) => a + "$" + i + s), vals)).rows;
const mem = new Map();
const store = {
  async get(k, o) { const v = mem.get(k); if (v === undefined) return null; return o && o.type === "json" ? JSON.parse(v) : v; },
  async set(k, v) { mem.set(k, String(v)); },
  async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
};
const db = makeDb(sql);
const ENV = { CAD_JOBS_WRITE_KEY: "write-key-123456", CAD_JOBS_READ_KEY: "read-key-1234567", CAD_FORM_ORIGINS: "https://diacrown.github.io" };
const ORIGIN = "https://diacrown.github.io";
let t = Date.now();
const call = (method, qs, { body, headers = {}, env = ENV } = {}) =>
  handler(new Request("https://calc.example/.netlify/functions/cad-jobs?" + qs, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), { env, store, db, now: t });
const W = { "x-cad-key": ENV.CAD_JOBS_WRITE_KEY, origin: ORIGIN };
const R = { "x-cad-read-key": ENV.CAD_JOBS_READ_KEY };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const j = async (r) => r.json();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const job = () => ({ JobNo: "J100", ItemNo: "MA5", "CAD Designer": "Pritam", VendorItemNo: "ACME-1", ItemType: "Ring",
  _RAW_STONES: [{ Shape: "Round", Qty: "4", Stone: "Mined" }, { Shape: "", Qty: "0" }],
  _VERSIONS: [{ id: 1, dataUrl: PNG, _hasImage: true, locked: false }, { id: 2, _hasImage: false }],
  _CLIENT_REF_IMAGES: [{ id: 9, _hasImage: true }] });

// CORS preflight
let r = await call("OPTIONS", "action=save", { headers: { origin: ORIGIN } });
ok(r.status === 204 && r.headers.get("access-control-allow-origin") === ORIGIN && !/\*/.test(r.headers.get("access-control-allow-origin")), "preflight from the form's address is answered, never '*'");
r = await call("OPTIONS", "action=save", { headers: { origin: "https://evil.example" } });
ok(r.status === 403, "preflight from another address refused");

// auth + origin
r = await call("POST", "action=save", { body: { job: job() }, headers: { origin: ORIGIN } });
ok(r.status === 401, "save without key -> 401");
r = await call("POST", "action=save", { body: { job: job() }, headers: { ...W, origin: "https://evil.example" } });
ok(r.status === 403, "save from other origin -> 403 even with the key");
r = await call("POST", "action=save", { body: { job: job() }, headers: W, env: {} });
ok(r.status === 503, "no key configured -> 503 (feature off)");
r = await call("POST", "action=save", { body: { job: job() }, headers: W, env: { CAD_JOBS_WRITE_KEY: "short" } });
ok(r.status === 503, "too-short key -> 503");
r = await call("GET", "action=list", {});
ok(r.status === 401, "list without read key -> 401");
r = await call("GET", "action=list", { headers: { "x-cad-read-key": ENV.CAD_JOBS_WRITE_KEY } });
ok(r.status === 401, "write key does not open reads");

// save
r = await call("POST", "action=save", { body: { job: job() }, headers: W });
let b = await j(r);
ok(r.status === 200 && b.ok && b.id === 1 && b.rev === 1 && JSON.stringify(b.slots) === '["v0","r0"]', "save -> id 1, rev 1, slots v0 r0");
ok(r.headers.get("access-control-allow-origin") === ORIGIN, "save reply carries the CORS header");
ok(!/data:image/.test(mem.get("jobs/1/job.json")), "no picture data stored inside job.json");
// images
r = await call("POST", "action=image", { body: { id: 1, slot: "v0", dataUrl: PNG }, headers: W });
b = await j(r); ok(b.ok && b.complete === false, "first image stored, not complete yet");
r = await call("POST", "action=image", { body: { id: 1, slot: "v0", dataUrl: PNG }, headers: W });
b = await j(r); ok(b.ok && b.complete === false, "re-sending the same picture is not counted twice");
r = await call("POST", "action=image", { body: { id: 1, slot: "r0", dataUrl: PNG }, headers: W });
b = await j(r); ok(b.ok && b.complete === true, "second image -> complete");
for (const [slot, d, why] of [["../x", PNG, "path-like slot"], ["v0", "data:text/html;base64,PGI+", "non-image"], ["v0", "javascript:alert(1)", "script url"]]) {
  r = await call("POST", "action=image", { body: { id: 1, slot, dataUrl: d }, headers: W });
  ok(r.status === 400, "rejects " + why);
}
r = await call("POST", "action=image", { body: { id: 1, slot: "v0", dataUrl: "data:image/png;base64," + "A".repeat(4_900_000) }, headers: W });
ok(r.status === 413, "oversized image -> 413");
r = await call("POST", "action=image", { body: { id: 99, slot: "v0", dataUrl: PNG }, headers: W });
ok(r.status === 404, "image for unknown job -> 404");

// revisions
r = await call("POST", "action=save", { body: { job: job() }, headers: W });
b = await j(r); ok(b.id === 2 && b.rev === 2, "same Job+Item again -> rev 2");
const other = job(); other.JobNo = "J200"; other["CAD Designer"] = "Som";
r = await call("POST", "action=save", { body: { job: other }, headers: W });
b = await j(r); ok(b.id === 3 && b.rev === 1, "different job -> rev 1");
r = await call("POST", "action=save", { body: { job: { JobNo: "", ItemNo: "" } }, headers: W });
ok(r.status === 400, "no job/item no -> 400");
r = await call("POST", "action=save", { body: { job: { JobNo: "X", _VERSIONS: [{ id: 1, junk: "x".repeat(1_600_000) }] } }, headers: W });
ok(r.status === 413, "huge job json -> 413");

// reads
r = await call("GET", "action=list", { headers: R }); b = await j(r);
ok(r.status === 200 && b.results.length === 3 && b.results[0].id === 3, "list: newest first, 3 rows");
r = await call("GET", "action=list&q=j100", { headers: R }); b = await j(r);
ok(b.results.length === 2 && b.results.every((x) => x.job_no === "J100"), "search by job no (case-insensitive)");
r = await call("GET", "action=list&q=som", { headers: R }); b = await j(r);
ok(b.results.length === 1 && b.results[0].designer === "Som", "search by designer");
r = await call("GET", "action=list&q=" + encodeURIComponent("%"), { headers: R }); b = await j(r);
ok(b.results.length === 0, "a lone % matches literally (nothing)");
r = await call("GET", "action=list&q=" + encodeURIComponent("'; DROP TABLE cad_jobs;--"), { headers: R }); b = await j(r);
ok(r.status === 200 && b.results.length === 0 && (await sql`SELECT count(*)::int AS n FROM cad_jobs`)[0].n === 3, "SQL-injection-style search is just text");
r = await call("GET", "action=job&id=1", { headers: R }); b = await j(r);
ok(b.job.JobNo === "J100" && b.meta.rev === 1 && b.meta.stone_rows === 1 && b.slots.length === 2, "job returns json + meta (1 stone row)");
r = await call("GET", "action=image&id=1&slot=v0", { headers: R }); b = await j(r);
ok(b.dataUrl === PNG, "image returns the picture");
r = await call("GET", "action=job&id=77", { headers: R }); ok(r.status === 404, "unknown job -> 404");
r = await call("GET", "action=image&id=1&slot=v5", { headers: R }); ok(r.status === 404, "unknown slot -> 404");
r = await call("GET", "action=job&id=abc", { headers: R }); ok(r.status === 400, "bad id -> 400");

// lock-out
for (let i = 0; i < MAX_FAILS; i++) await call("GET", "action=list", { headers: { "x-cad-read-key": "wrong-wrong-wrong" } });
r = await call("GET", "action=list", { headers: R });
ok(r.status === 429, "after " + MAX_FAILS + " wrong tries even the right read key is locked out");
t += 16 * 60 * 1000;
r = await call("GET", "action=list", { headers: R });
ok(r.status === 200, "lock-out ends after 15 minutes");
r = await call("POST", "action=save", { body: { job: job() }, headers: W });
ok(r.status === 200, "write side unaffected by read lock-out");
r = await call("PUT", "action=save", { headers: W }); ok(r.status === 405, "other methods -> 405");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
