import { neon } from "@netlify/neon";

// Called as the user types into the "search previous quotes" box.
// Matches partial Job# or Item# (case-insensitive), most recent first.
export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const sql = neon();
    // Escape LIKE wildcards (and the escape character itself) so the user's
    // text is matched literally. Postgres ILIKE uses backslash as its
    // default escape character, so no ESCAPE clause is needed.
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
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
    console.error("search-quotes failed:", err);
    return new Response(JSON.stringify({ error: "Server error, try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
