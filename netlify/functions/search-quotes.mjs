import { neon } from "@netlify/neon";

// Called as the user types into the "search previous quotes" box.
// Matches partial Job# or Item# (case-insensitive), most recent first.
export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const job = (url.searchParams.get("job") || "").trim();
  const item = (url.searchParams.get("item") || "").trim();

  // Exact Job # + Item # lookup: every saved stage/version of that one item (used to offer the next version number).
  if (job && item) {
    try {
      const sql = neon();
      const rows = await sql`
        SELECT quote_stage, created_at FROM quotes
        WHERE job_no = ${job} AND item_no = ${item}
        ORDER BY created_at DESC
        LIMIT 500
      `;
      return new Response(JSON.stringify({ results: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const sql = neon();
    const pattern = `%${q}%`;
    const rows = await sql`
      SELECT id, job_no, item_no, quote_stage, filename_base, created_at
      FROM quotes
      WHERE job_no ILIKE ${pattern} OR item_no ILIKE ${pattern}
      ORDER BY created_at DESC
      LIMIT 25
    `;
    return new Response(JSON.stringify({ results: rows }), {
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
