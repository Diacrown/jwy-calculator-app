import { getStore } from "@netlify/blobs";

// Fetches a previously saved quote's JSON snapshot by filename, so the
// app can restore it directly -- same applySnapshot() path as the
// existing "Load saved quote" file upload, just sourced from the cloud
// instead of a local file.
export default async (req) => {
  const url = new URL(req.url);
  const filenameBase = url.searchParams.get("filenameBase");

  if (!filenameBase) {
    return new Response(JSON.stringify({ error: "Missing filenameBase" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("quotes");
    // New per-quote folder structure first; fall back to the old flat
    // naming for anything saved before this change, so existing quotes
    // don't silently become unreachable.
    let jsonText = await store.get(`${filenameBase}/quote.json`);
    if (jsonText === null) jsonText = await store.get(`${filenameBase}.json`);
    if (jsonText === null) {
      return new Response(JSON.stringify({ error: "Quote not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(jsonText, {
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
