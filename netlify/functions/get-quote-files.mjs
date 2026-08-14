import { getStore } from "@netlify/blobs";

// Fetches BOTH the PDF and JSON already stored for one quote (unlike
// load-quote.mjs, which only returns the JSON for reloading into the
// app). Used by the Drive migration feature so it can copy the exact
// PDF that was actually generated at save time, not a regenerated one.
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
    // naming for anything saved before this change.
    let [pdfBytes, jsonText] = await Promise.all([
      store.get(`${filenameBase}/quote.pdf`, { type: "arrayBuffer" }),
      store.get(`${filenameBase}/quote.json`, { type: "text" }),
    ]);
    if (pdfBytes === null) pdfBytes = await store.get(`${filenameBase}.pdf`, { type: "arrayBuffer" });
    if (jsonText === null) jsonText = await store.get(`${filenameBase}.json`, { type: "text" });

    if (pdfBytes === null || jsonText === null) {
      return new Response(JSON.stringify({ error: "One or both files not found for this quote" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    return new Response(JSON.stringify({ pdfBase64, jsonText }), {
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
