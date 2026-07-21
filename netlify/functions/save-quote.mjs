import { neon } from "@netlify/neon";
import { getStore } from "@netlify/blobs";

// Called only when the user explicitly clicks "Sync to DB" -- NOT
// automatically on every print. This is deliberate: printing the same
// quote twice (e.g. full prices, then price-only, to check both)
// should never create two database rows for what's really one quote.
// Saving to the cloud is a separate, intentional action.
//
// Before writing anything, checks whether this exact Job#+Item#+Stage
// combination has already been saved. If so, rejects with a clear,
// specific error rather than silently creating a duplicate or
// overwriting the existing record -- the user is expected to bump the
// Quote Stage (Q1 -> Q2) before saving again.
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

    const sql = neon();

    // Uniqueness check -- one row per (job_no, item_no, quote_stage).
    // Blank job/item values are allowed to repeat (nothing meaningful
    // to be unique about), so only check when both are actually filled.
    if (jobNo && itemNo) {
      const existing = await sql`
        SELECT id FROM quotes
        WHERE job_no = ${jobNo} AND item_no = ${itemNo} AND quote_stage = ${quoteStage || ""}
        LIMIT 1
      `;
      if (existing.length > 0) {
        return new Response(
          JSON.stringify({
            error: `Please update your quotation stage before saving -- ${quoteStage || "this stage"} already exists in the database for Job ${jobNo} / Item ${itemNo}.`,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const store = getStore("quotes");
    const pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    await store.set(`${filenameBase}.pdf`, pdfBytes, { metadata: { type: "pdf" } });
    await store.set(`${filenameBase}.json`, jsonText, { metadata: { type: "json" } });

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
