import { getStore } from "@netlify/blobs";
import { METALS, londonNow } from "./_metalPolicy.mjs";

// Developer-only: set or clear the PM rate (e.g. type in the official LBMA
// figure). Protected by the METAL_ADMIN_TOKEN environment variable (set it in
// Netlify). Without that variable the endpoint refuses every request.
//   POST  { "AU": 4089.25, "PT": 1635.3 }   -> set overrides (USD per oz)
//   POST  { "clear": true }                 -> remove all overrides
// Header required:  x-admin-token: <METAL_ADMIN_TOKEN>
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  const expected = process.env.METAL_ADMIN_TOKEN;
  if (!expected || req.headers.get("x-admin-token") !== expected) return json({ error: "Not authorised" }, 401);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const store = getStore("metal-rates-cache");
  if (body && body.clear === true) { await store.setJSON("pm-override", {}); return json({ ok: true, cleared: true }); }
  const cur = (await store.get("pm-override", { type: "json" }).catch(() => null)) || {};
  const now = londonNow();
  for (const code of Object.keys(METALS)) {
    if (body && body[code] !== undefined) {
      const price = Number(body[code]);
      if (!isFinite(price) || price <= 0) return json({ error: `Bad price for ${code}` }, 400);
      cur[code] = { price, label: `${now.label} PM (manual)`, setAt: new Date().toISOString() };
    }
  }
  await store.setJSON("pm-override", cur);
  return json({ ok: true, override: cur });
};
