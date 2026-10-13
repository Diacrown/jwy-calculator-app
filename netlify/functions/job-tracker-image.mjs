import { getStore } from "@netlify/blobs";

// Backs the "Export to Main File" image columns (Image1/Image2/Image3).
// Main File wants a real URL in those cells (to copy-paste in, possibly
// into an IMAGE() formula), not an embedded picture and not a bare
// filename -- so each image gets uploaded here once at export time and
// this same function serves it back out by key.
//
// POST  { filenameBase, slot, dataUrl } -> stores the image, returns
//       { url: "/.netlify/functions/job-tracker-image?key=..." }
//       (the frontend prefixes this with window.location.origin to get
//       a real absolute, pasteable URL for whichever deploy -- Testing
//       preview or production -- actually served the request).
// GET   ?key=... -> streams the image back with the right Content-Type,
//       so the URL above works as a normal image link anywhere.
//
// Same store/pattern as save-quote.mjs and get-quote-files.mjs (no
// auth, same as every other Netlify function in this app -- internal
// tool, not public-facing).
const EXT_TO_CONTENT_TYPE = { png: "image/png", jpeg: "image/jpeg" };

export default async (req) => {
  const store = getStore("jobtracker-images");

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { filenameBase, slot, dataUrl } = body;
      if (!filenameBase || !slot || !dataUrl) {
        return new Response(JSON.stringify({ error: "Missing filenameBase, slot, or dataUrl" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
      if (!match) {
        return new Response(JSON.stringify({ error: "dataUrl must be a base64 image/png or image/jpeg data URL" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const extension = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

      const key = `${filenameBase}/${slot}.${extension}`;
      await store.set(key, bytes, { metadata: { contentType: EXT_TO_CONTENT_TYPE[extension] } });

      return new Response(JSON.stringify({ url: `/.netlify/functions/job-tracker-image?key=${encodeURIComponent(key)}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const { data, metadata } = (await store.getWithMetadata(key, { type: "arrayBuffer" })) || {};
      if (!data) {
        return new Response(JSON.stringify({ error: "Image not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const contentType = metadata?.contentType || (key.endsWith(".png") ? "image/png" : "image/jpeg");
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};
