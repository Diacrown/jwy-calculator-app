import { neon } from "@netlify/neon";
import { getStore } from "@netlify/blobs";

// Called from the app every time Print (full prices / price only) runs.
// Stores the PDF and JSON as blobs, and logs a searchable row (Job#,
// Item#, stage, timestamp) in the database so a later search can find
// and reload this exact quote. This runs ALONGSIDE the existing local
// .zip download, not instead of it -- if this cloud save fails for any
// reason (network, quota, etc.), the local download still succeeds, so
// nobody loses their quote just because the archive step had a problem.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { filenameBase, jobNo, itemNo, quoteStage, pdfBase64, jsonText } = body;

    if (!filenameBase || !pdfBase64 || !jsonText) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const store = getStore("quotes");
    const pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    await store.set(`${filenameBase}.pdf`, pdfBytes, { metadata: { type: "pdf" } });
    await store.set(`${filenameBase}.json`, jsonText, { metadata: { type: "json" } });

    const sql = neon();
    await sql`
      INSERT INTO quotes (job_no, item_no, quote_stage, filename_base, created_at)
      VALUES (${jobNo || ""}, ${itemNo || ""}, ${quoteStage || ""}, ${filenameBase}, now())
    `;

    return new Response(JSON.stringify({ ok: true, filenameBase }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
