import { getStore } from "@netlify/blobs";

// Remembers what was filled in under "Job Tracker details" (Section 07) for
// each Job No, so the same job number comes back pre-filled the next time it
// is opened -- on any machine.
//
// GET   ?jobNo=4376          -> { fields: {...}, updatedAt } or { fields: null }
// POST  { jobNo, fields }    -> stores the fields object for that job
//
// Same pattern as job-tracker-image.mjs (Netlify Blobs, no auth -- internal
// tool). The app also keeps its own copy in the browser, so a failure here
// never blocks anything; it just means that copy is the only one.
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const cleanKey = (v) => String(v || "").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 80);

export default async (req) => {
  try {
    const store = getStore("jobtracker-fields");

    if (req.method === "GET") {
      const key = cleanKey(new URL(req.url).searchParams.get("jobNo"));
      if (!key) return json(400, { error: "Missing jobNo" });
      const saved = await store.get(`${encodeURIComponent(key)}.json`, { type: "json" });
      return json(200, saved ? { fields: saved.fields || null, updatedAt: saved.updatedAt || 0 } : { fields: null });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const key = cleanKey(body && body.jobNo);
      if (!key || !body.fields || typeof body.fields !== "object") {
        return json(400, { error: "Missing jobNo or fields" });
      }
      // Only plain text values are kept (every Section 07 field is text).
      const fields = {};
      for (const [k, v] of Object.entries(body.fields)) {
        if (typeof v === "string") fields[String(k).slice(0, 60)] = v.slice(0, 500);
      }
      const updatedAt = Date.now();
      await store.setJSON(`${encodeURIComponent(key)}.json`, { jobNo: key, fields, updatedAt });
      return json(200, { ok: true, updatedAt });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return json(500, { error: err.message || String(err) });
  }
};
