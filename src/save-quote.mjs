import { neon } from "@netlify/neon";
import { getStore } from "@netlify/blobs";

// Called only when the user explicitly clicks "Sync to DB" -- NOT
// automatically on every print. This is deliberate: printing the same
// quote twice (e.g. full prices, then price-only, to check both)
// should never create two database rows for what's really one quote.
// Saving to the cloud is a separate, intentional action.
//
// Before writing anything, checks whether this exact Job#+Item#+Stage
// combination has already been saved.
//   - Without `overwrite: true` in the request, this is a hard stop:
//     returns 409 with details of the existing record (who/when, via
//     filename_base's timestamp), so the frontend can show the person
//     a real confirmation prompt rather than a vague error.
//   - With `overwrite: true`, replaces the existing record in place --
//     the OLD blob files (PDF+JSON) are deleted, the NEW files are
//     written under a fresh filename, and the EXISTING database row is
//     UPDATED (same id) to point at the new files and a new
//     created_at timestamp. This is a genuine overwrite, not a second
//     row -- there is still only ever one row per (job_no, item_no,
//     quote_stage), whether this is the first save or the tenth.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { filenameBase, jobNo, itemNo, quoteStage, pdfBase64, jsonText, overwrite } = body;

    if (!filenameBase || !pdfBase64 || !jsonText) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sql = neon();
    const store = getStore("quotes");

    // Uniqueness check -- one row per (job_no, item_no, quote_stage).
    // Blank job/item values are allowed to repeat (nothing meaningful
    // to be unique about), so only check when both are actually filled.
    let existingRow = null;
    if (jobNo && itemNo) {
      const existing = await sql`
        SELECT id, filename_base, created_at FROM quotes
        WHERE job_no = ${jobNo} AND item_no = ${itemNo} AND quote_stage = ${quoteStage || ""}
        LIMIT 1
      `;
      existingRow = existing[0] || null;
    }

    if (existingRow && !overwrite) {
      // Hard stop -- give the frontend everything it needs to ask a
      // real, informed "overwrite this?" question, not a guess.
      return new Response(
        JSON.stringify({
          error: `A quote already exists for Job ${jobNo} / Item ${itemNo} / ${quoteStage || "this stage"}.`,
          conflict: true,
          existing: {
            id: existingRow.id,
            filenameBase: existingRow.filename_base,
            createdAt: existingRow.created_at,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    const pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    // One folder per quote (named after filenameBase), containing both
    // its PDF and JSON together -- much clearer to browse than a flat
    // list of many PDFs and JSONs interleaved.
    await store.set(`${filenameBase}/quote.pdf`, pdfBytes, { metadata: { type: "pdf" } });
    await store.set(`${filenameBase}/quote.json`, jsonText, { metadata: { type: "json" } });

    if (existingRow && overwrite) {
      // Genuine overwrite: remove the OLD blob files so nothing orphaned
      // is left taking up storage, then point the SAME database row at
      // the new files, with created_at refreshed to reflect this save.
      if (existingRow.filename_base && existingRow.filename_base !== filenameBase) {
        try {
          await store.delete(`${existingRow.filename_base}/quote.pdf`);
          await store.delete(`${existingRow.filename_base}/quote.json`);
        } catch {
          // Old files may already be gone (e.g. from a pre-folder-structure
          // save) -- not a reason to fail the overwrite itself.
        }
      }
      await sql`
        UPDATE quotes
        SET filename_base = ${filenameBase}, created_at = now()
        WHERE id = ${existingRow.id}
      `;
      return new Response(JSON.stringify({ ok: true, filenameBase, overwritten: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

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
