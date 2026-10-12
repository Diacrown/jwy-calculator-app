import { getStore } from "@netlify/blobs";

// Remembers which stone-schedule fields were set to "Custom entry…" (Type /
// Shape / Size) for each Job No, plus what was typed into them, so the same
// job comes back with those fields custom again -- on any machine.
//
// GET   ?jobNo=7086            -> { lines: [...], updatedAt } or { lines: null }
// POST  { jobNo, lines: [...] } -> stores the list for that job ([] clears it)
//
// Same pattern as job-tracker-fields.mjs (Netlify Blobs, no auth -- internal
// tool). The app keeps its own copy in the browser too, so a failure here
// never blocks anything.
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const cleanKey = (v) => String(v || "").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 80);
const text = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");

export default async (req) => {
  try {
    const store = getStore("jobstone-custom");

    if (req.method === "GET") {
      const key = cleanKey(new URL(req.url).searchParams.get("jobNo"));
      if (!key) return json(400, { error: "Missing jobNo" });
      const saved = await store.get(`${encodeURIComponent(key)}.json`, { type: "json" });
      return json(200, saved && Array.isArray(saved.lines) ? { lines: saved.lines, updatedAt: saved.updatedAt || 0 } : { lines: null });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const key = cleanKey(body && body.jobNo);
      if (!key || !Array.isArray(body.lines)) return json(400, { error: "Missing jobNo or lines" });
      const lines = body.lines.slice(0, 100).map((l) => ({
        k: text(l && l.k, 300),
        shapeSel: text(l && l.shapeSel, 80),
        sizeCustom: !!(l && l.sizeCustom),
        customShape: text(l && l.customShape),
        customSizeText: text(l && l.customSizeText),
        customWt: text(l && l.customWt, 30),
        customRate: text(l && l.customRate, 30),
        typeCustom: !!(l && l.typeCustom),
        customType: text(l && l.customType, 80),
      })).filter((l) => l.k);
      const updatedAt = Date.now();
      await store.setJSON(`${encodeURIComponent(key)}.json`, { jobNo: key, lines, updatedAt });
      return json(200, { ok: true, updatedAt });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return json(500, { error: err.message || String(err) });
  }
};
