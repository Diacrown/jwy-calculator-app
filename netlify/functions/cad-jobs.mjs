import crypto from "node:crypto";
import { neon } from "@netlify/neon";
import { getStore } from "@netlify/blobs";

// CAD job inbox: the CAD Order Form saves every job it exports here, and the
// calculator lists and loads them -- so the order team no longer needs the
// .json file to be e-mailed, downloaded and uploaded.
//
// WRITE (called by the CAD Order Form, a different web address -> CORS)
//   POST ?action=save   body { job }              job = the form's JSON with the image pictures
//                                                  taken out (_VERSIONS / _CLIENT_REF_IMAGES entries
//                                                  keep id/locked and get "_hasImage": true)
//                                                  -> { ok, id, rev, slots:["v0","r0",...] }
//   POST ?action=image  body { id, slot, dataUrl } -> { ok, complete }
//   header x-cad-key must equal the CAD_JOBS_WRITE_KEY environment variable.
//
// READ + "used" mark (called by the calculator page itself, same address as this function; no key to type)
//   GET  ?action=designers                        [{ designer, total, unused, last_at }]
//   GET  ?action=list&view=recent|bank&designer=&q=&limit=&offset=
//          recent = jobs nobody has loaded into the calculator yet (newest first)
//          bank   = jobs already used (add &all=1 to include the not-yet-used ones too)
//   GET  ?action=job&id=N                         { meta, job, slots:[...] }
//   GET  ?action=image&id=N&slot=v0               { dataUrl }
//   POST ?action=use&id=N                         marks the job (and its older revisions) as used -> it moves
//                                                  from "recent" into that designer's bank
//
// Safety
//  * Saving needs the write key (Netlify variable CAD_JOBS_WRITE_KEY, >= 12 characters, else 503). Compared in
//    constant time; 8 wrong tries in 15 minutes lock saving for the rest of the window.
//  * Reading needs no key, but only the calculator's own page may do it: a browser request must be same-origin
//    (Sec-Fetch-Site / Origin / Referer). This keeps other websites out; like the rest of this app's functions it
//    is not a login, so anyone who can reach the calculator site and forge those headers could read.
//  * Cross-origin saving is accepted only from the addresses in CAD_FORM_ORIGINS (comma separated, default
//    https://diacrown.github.io). Replies never use "*".
//  * Size caps on everything; nothing the caller sends is ever used as a file path or in SQL text.
//  * Storage: Postgres table cad_jobs (created on first use, safe to run repeatedly) holds the list,
//    Netlify Blobs store "cad-jobs" holds the job JSON and the pictures.

export const MIN_KEY_LEN = 12;
export const MAX_FAILS = 8;
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_JOB_CHARS = 1_500_000;      // the job JSON without pictures
export const MAX_IMAGE_CHARS = 4_800_000;    // one picture as a data URL (Netlify allows 6 MB per request)
export const MAX_SLOTS = 40;
const DEFAULT_ORIGINS = "https://diacrown.github.io";
const SLOT_RE = /^[vr]\d{1,2}$/;
const IMG_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const sameKey = (given, expected) => crypto.timingSafeEqual(digest(given || ""), digest(expected));
const clean = (v, max = 120) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// A read/"use" request is accepted only when the browser says it comes from this very site.
function isSameSite(req) {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs) return sfs === "same-origin";
  const host = new URL(req.url).host;
  for (const h of ["origin", "referer"]) {
    const v = req.headers.get(h);
    if (v) { try { return new URL(v).host === host; } catch { return false; } }
  }
  return false;
}

function allowedOrigins(env) {
  return String(env.CAD_FORM_ORIGINS || DEFAULT_ORIGINS).split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin");
  const h = { Vary: "Origin" };
  if (origin && allowedOrigins(env).includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, x-cad-key";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

const reply = (req, env, status, body, extra = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req, env), ...extra },
  });

// ---- key check with lock-out -------------------------------------------------
async function checkKey(kind, given, expected, store, now) {
  if (String(expected || "").length < MIN_KEY_LEN) {
    return { ok: false, status: 503, error: "CAD job storage is not set up on this site yet (key missing or too short)." };
  }
  let fails = [];
  const lockKey = `security/fails-${kind}`;
  try {
    const doc = await store.get(lockKey, { type: "json" });
    if (doc && Array.isArray(doc.at)) fails = doc.at.filter((t) => now - t < WINDOW_MS);
  } catch {}
  if (fails.length >= MAX_FAILS) return { ok: false, status: 429, error: "Too many wrong attempts. Try again in about 15 minutes." };
  if (!sameKey(given, expected)) {
    fails.push(now);
    try { await store.setJSON(lockKey, { at: fails }); } catch {}
    return { ok: false, status: 401, error: "Wrong key." };
  }
  if (fails.length) { try { await store.setJSON(lockKey, { at: [] }); } catch {} }
  return { ok: true };
}

// ---- database (real SQL; tests run it on a real Postgres engine) -----------------
export function makeDb(sql) {
  let ready = false;
  const ensure = async () => {
    if (ready) return;
    await sql`CREATE TABLE IF NOT EXISTS cad_jobs (
      id SERIAL PRIMARY KEY,
      job_no TEXT NOT NULL DEFAULT '',
      item_no TEXT NOT NULL DEFAULT '',
      rev INTEGER NOT NULL DEFAULT 1,
      designer TEXT NOT NULL DEFAULT '',
      vendor_item_no TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL DEFAULT '',
      stone_rows INTEGER NOT NULL DEFAULT 0,
      images_expected INTEGER NOT NULL DEFAULT 0,
      images_saved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      used_at TIMESTAMPTZ
    )`;
    await sql`ALTER TABLE cad_jobs ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_jobs_job_item_rev ON cad_jobs (job_no, item_no, rev)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cad_jobs_created ON cad_jobs (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cad_jobs_designer ON cad_jobs (designer, created_at DESC)`;
    ready = true;
  };
  return {
    ensure,
    // One row per export; rev counts re-exports of the same Job # + Item #.
    async insert(m) {
      await ensure();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rows = await sql`
            INSERT INTO cad_jobs (job_no, item_no, rev, designer, vendor_item_no, item_type, stone_rows, images_expected)
            VALUES (${m.jobNo}, ${m.itemNo},
                    COALESCE((SELECT MAX(rev) FROM cad_jobs WHERE job_no = ${m.jobNo} AND item_no = ${m.itemNo}), 0) + 1,
                    ${m.designer}, ${m.vendorItemNo}, ${m.itemType}, ${m.stoneRows}, ${m.imagesExpected})
            RETURNING id, rev`;
          return rows[0];
        } catch (err) {
          if (attempt === 2 || !/duplicate|unique/i.test(String(err && err.message))) throw err;
        }
      }
    },
    async countImage(id) {
      await ensure();
      const rows = await sql`UPDATE cad_jobs SET images_saved = LEAST(images_saved + 1, images_expected) WHERE id = ${id}
                             RETURNING images_expected, images_saved`;
      return rows[0] || null;
    },
    async get(id) {
      await ensure();
      const rows = await sql`SELECT id, job_no, item_no, rev, designer, vendor_item_no, item_type, stone_rows,
                                    images_expected, images_saved, created_at, used_at FROM cad_jobs WHERE id = ${id}`;
      return rows[0] || null;
    },
    // view "recent" = not used yet; "bank" = used (all = true adds the unused ones). designer: null = everyone, "" = no designer.
    async list({ view, designer, q, all, limit, offset }) {
      await ensure();
      const mode = view === "bank" ? (all ? "all" : "used") : "unused";
      const p = q ? "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
      return sql`SELECT id, job_no, item_no, rev, designer, vendor_item_no, item_type, stone_rows,
                        images_expected, images_saved, created_at, used_at
                 FROM cad_jobs
                 WHERE (${mode}::text = 'all' OR (${mode}::text = 'unused' AND used_at IS NULL) OR (${mode}::text = 'used' AND used_at IS NOT NULL))
                   AND (${designer}::text IS NULL OR designer = ${designer}::text)
                   AND (${p}::text IS NULL OR job_no ILIKE ${p}::text OR item_no ILIKE ${p}::text OR vendor_item_no ILIKE ${p}::text OR designer ILIKE ${p}::text)
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${limit} OFFSET ${offset}`;
    },
    async designers() {
      await ensure();
      return sql`SELECT designer, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE used_at IS NULL)::int AS unused,
                        MAX(created_at) AS last_at
                 FROM cad_jobs GROUP BY designer ORDER BY unused DESC, last_at DESC`;
    },
    // Using a job also retires its older revisions (same Job + Item); a newer re-export stays "recent".
    async markUsed(id) {
      await ensure();
      const rows = await sql`UPDATE cad_jobs SET used_at = now()
                             WHERE job_no = (SELECT job_no FROM cad_jobs WHERE id = ${id})
                               AND item_no = (SELECT item_no FROM cad_jobs WHERE id = ${id})
                               AND rev <= (SELECT rev FROM cad_jobs WHERE id = ${id})
                             RETURNING id`;
      return rows.length;
    },
  };
}

const slotsOf = (job) => {
  const out = [];
  (Array.isArray(job._VERSIONS) ? job._VERSIONS : []).forEach((v, i) => { if (v && v._hasImage) out.push("v" + i); });
  (Array.isArray(job._CLIENT_REF_IMAGES) ? job._CLIENT_REF_IMAGES : []).forEach((v, i) => { if (v && v._hasImage) out.push("r" + i); });
  return out;
};

// ---- the function -----------------------------------------------------------
// ctx is Netlify's own second argument; the extra keys (env, store, db, now) are only used by the tests.
export default async (req, ctx = {}) => {
  const env = ctx.env || process.env;
  const now = ctx.now || Date.now();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  if (req.method === "OPTIONS") {
    const h = corsHeaders(req, env);
    return h["Access-Control-Allow-Origin"] ? new Response(null, { status: 204, headers: h }) : new Response(null, { status: 403 });
  }

  try {
    const store = ctx.store || getStore("cad-jobs");
    const db = ctx.db || makeDb(neon());

    // ---------------- "used" mark (calculator page, same site, no key) ----------------
    if (req.method === "POST" && action === "use") {
      if (!isSameSite(req)) return reply(req, env, 403, { error: "Not allowed." });
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id < 1) return reply(req, env, 400, { error: "Bad id." });
      const n = await db.markUsed(id);
      return n ? reply(req, env, 200, { ok: true, marked: n }) : reply(req, env, 404, { error: "Job not found." });
    }

    // ---------------- writes (CAD form) ----------------
    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      if (origin && !allowedOrigins(env).includes(origin)) return reply(req, env, 403, { error: "This address is not allowed to save jobs." });
      const auth = await checkKey("write", req.headers.get("x-cad-key"), env.CAD_JOBS_WRITE_KEY, store, now);
      if (!auth.ok) return reply(req, env, auth.status, { error: auth.error });

      let body;
      try { body = await req.json(); } catch { return reply(req, env, 400, { error: "Invalid JSON" }); }

      if (action === "save") {
        const job = body && body.job;
        if (!job || typeof job !== "object" || Array.isArray(job)) return reply(req, env, 400, { error: "No job data." });
        const jobNo = clean(job["JobNo"], 60), itemNo = clean(job["ItemNo"], 60);
        if (!jobNo && !itemNo) return reply(req, env, 400, { error: "The job has no Job No or Item No." });
        // No picture data may ride along in the JSON: pictures go one per request.
        for (const list of [job._VERSIONS, job._CLIENT_REF_IMAGES]) {
          if (list !== undefined && !Array.isArray(list)) return reply(req, env, 400, { error: "Bad image list." });
          (list || []).forEach((v) => { if (v && typeof v === "object") delete v.dataUrl; });
        }
        const text = JSON.stringify(job);
        if (text.length > MAX_JOB_CHARS) return reply(req, env, 413, { error: "Job data is too large." });
        const slots = slotsOf(job);
        if (slots.length > MAX_SLOTS) return reply(req, env, 413, { error: "Too many images." });
        const stones = Array.isArray(job._RAW_STONES) ? job._RAW_STONES.filter((s) => s && (s.Shape || s.Stone) && Number(s.Qty) > 0).length : 0;

        const row = await db.insert({
          jobNo, itemNo, designer: clean(job["CAD Designer"], 60), vendorItemNo: clean(job["VendorItemNo"], 80),
          itemType: clean(job["ItemType"], 60), stoneRows: stones, imagesExpected: slots.length,
        });
        await store.set(`jobs/${row.id}/job.json`, text, { metadata: { type: "job" } });
        return reply(req, env, 200, { ok: true, id: row.id, rev: row.rev, slots });
      }

      if (action === "image") {
        const id = Number(body && body.id);
        const slot = String((body && body.slot) || "");
        const dataUrl = String((body && body.dataUrl) || "");
        if (!Number.isInteger(id) || id < 1 || !SLOT_RE.test(slot)) return reply(req, env, 400, { error: "Bad id or slot." });
        if (dataUrl.length > MAX_IMAGE_CHARS) return reply(req, env, 413, { error: "Image is too large." });
        if (!IMG_RE.test(dataUrl)) return reply(req, env, 400, { error: "Not an image." });
        const meta = await db.get(id);
        if (!meta) return reply(req, env, 404, { error: "No such job." });
        const had = await store.get(`jobs/${id}/img-${slot}`);
        await store.set(`jobs/${id}/img-${slot}`, dataUrl, { metadata: { type: "image" } });
        // A re-sent picture is not counted twice.
        const c = had !== null && had !== undefined ? meta : await db.countImage(id);
        return reply(req, env, 200, { ok: true, complete: !!c && c.images_saved >= c.images_expected });
      }
      return reply(req, env, 400, { error: "Unknown action." });
    }

    // ---------------- reads (calculator page, same site, no key) ----------------
    if (req.method === "GET") {
      if (!isSameSite(req)) return reply(req, env, 403, { error: "Not allowed." });

      if (action === "designers") return reply(req, env, 200, { designers: await db.designers() });
      if (action === "list") {
        const sp = url.searchParams;
        const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "30", 10) || 30));
        const offset = Math.min(100000, Math.max(0, parseInt(sp.get("offset") || "0", 10) || 0));
        const rows = await db.list({
          view: sp.get("view") === "bank" ? "bank" : "recent",
          designer: sp.has("designer") ? clean(sp.get("designer"), 60) : null,
          q: clean(sp.get("q"), 60),
          all: sp.get("all") === "1",
          limit,
          offset,
        });
        return reply(req, env, 200, { results: rows, hasMore: rows.length === limit });
      }
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id) || id < 1) return reply(req, env, 400, { error: "Bad id." });

      if (action === "job") {
        const meta = await db.get(id);
        const job = meta ? await store.get(`jobs/${id}/job.json`, { type: "json" }) : null;
        if (!meta || !job) return reply(req, env, 404, { error: "Job not found." });
        return reply(req, env, 200, { meta, job, slots: slotsOf(job) });
      }
      if (action === "image") {
        const slot = String(url.searchParams.get("slot") || "");
        if (!SLOT_RE.test(slot)) return reply(req, env, 400, { error: "Bad slot." });
        const dataUrl = await store.get(`jobs/${id}/img-${slot}`);
        if (dataUrl === null || dataUrl === undefined) return reply(req, env, 404, { error: "Image not found." });
        return reply(req, env, 200, { dataUrl });
      }
      return reply(req, env, 400, { error: "Unknown action." });
    }

    return reply(req, env, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("cad-jobs:", err);
    return reply(req, env, 500, { error: "Server error while handling the CAD job." });
  }
};
