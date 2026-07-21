import { neon } from "@netlify/neon";

// Returns quote volume stats: counts for the last 7 and 30 days, plus
// the 10 most recent quotes for a quick-glance list. Uses the same
// `quotes` table that save-quote/search-quotes already write to and
// read from -- no new schema needed.
export default async () => {
  try {
    const sql = neon();

    const [weekRow] = await sql`
      SELECT COUNT(*)::int AS count FROM quotes WHERE created_at >= now() - interval '7 days'
    `;
    const [monthRow] = await sql`
      SELECT COUNT(*)::int AS count FROM quotes WHERE created_at >= now() - interval '30 days'
    `;
    const recent = await sql`
      SELECT id, job_no, item_no, quote_stage, created_at
      FROM quotes
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return new Response(
      JSON.stringify({
        weekCount: weekRow?.count ?? 0,
        monthCount: monthRow?.count ?? 0,
        recent,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
