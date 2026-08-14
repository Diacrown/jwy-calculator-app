import { neon } from "@netlify/neon";

// Returns every quote ever saved via Sync to DB -- used by the Drive
// migration feature to know what to copy over. Unlike search-quotes,
// this has no search term filter; it's meant for a one-time bulk
// operation, not interactive typing.
export default async () => {
  try {
    const sql = neon();
    const quotes = await sql`
      SELECT id, job_no, item_no, quote_stage, filename_base, created_at
      FROM quotes
      ORDER BY created_at ASC
    `;
    return new Response(JSON.stringify({ quotes }), {
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
