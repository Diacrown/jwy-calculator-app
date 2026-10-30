// Browser side of the "CAD jobs" dropdown and Designer Bank: talks to netlify/functions/cad-jobs.mjs.
// Same site as the calculator, so nothing to type and no CORS; the function only answers this site's own pages.

const ENDPOINT = "/.netlify/functions/cad-jobs";
const PICTURE_PARALLEL = 3;

async function call(method, params) {
  const res = await fetch(`${ENDPOINT}?${params}`, { method, cache: "no-store" });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error(
      (body && body.error) ||
        (res.status === 404 ? "CAD job storage is not available on this site yet." : res.status === 503 ? "CAD job storage is not set up yet." : `Request failed (${res.status})`)
    );
    err.status = res.status;
    throw err;
  }
  return body;
}

// [{ designer, total, unused, last_at }]  (designer "" = jobs saved without a designer)
export async function listCadDesigners() {
  const body = await call("GET", "action=designers");
  return Array.isArray(body.designers) ? body.designers : [];
}

// view "recent": jobs nobody has loaded yet. view "bank": jobs already used (all: true adds the unused ones).
// designer: undefined = every designer, "" = no designer, otherwise the name.
export async function listCadJobs({ view = "recent", designer, q = "", all = false, limit = 30, offset = 0 } = {}) {
  const p = new URLSearchParams({ action: "list", view, limit: String(limit), offset: String(offset) });
  if (designer !== undefined && designer !== null) p.set("designer", designer);
  if (q) p.set("q", q);
  if (all) p.set("all", "1");
  const body = await call("GET", p.toString());
  return { rows: Array.isArray(body.results) ? body.results : [], hasMore: !!body.hasMore };
}

// Moves the job (and its older revisions) from "recent" into the designer's bank.
export async function markCadJobUsed(id) {
  return call("POST", `action=use&id=${encodeURIComponent(id)}`);
}

// Rebuilds the same .json the CAD form puts in its ZIP (pictures put back in) and returns it as a File,
// so the existing "Load order data" import can read it unchanged.
export async function fetchCadJobFile(id) {
  const { meta, job, slots } = await call("GET", `action=job&id=${encodeURIComponent(id)}`);
  const lists = { v: Array.isArray(job._VERSIONS) ? job._VERSIONS : [], r: Array.isArray(job._CLIENT_REF_IMAGES) ? job._CLIENT_REF_IMAGES : [] };
  let missingImages = 0;
  const queue = [...(slots || [])];
  const worker = async () => {
    while (queue.length) {
      const slot = queue.shift();
      try {
        const { dataUrl } = await call("GET", `action=image&id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`);
        const entry = lists[slot[0]][Number(slot.slice(1))];
        if (entry && dataUrl) entry.dataUrl = dataUrl; else missingImages++;
      } catch {
        missingImages++;
      }
    }
  };
  await Promise.all(Array.from({ length: PICTURE_PARALLEL }, worker));
  // Entries whose picture never arrived are dropped, exactly as the form leaves out empty slots.
  job._VERSIONS = lists.v.filter((v) => v && v.dataUrl).map(({ _hasImage, ...rest }) => rest);
  job._CLIENT_REF_IMAGES = lists.r.filter((v) => v && v.dataUrl).map(({ _hasImage, ...rest }) => rest);
  const safe = (s) => String(s || "").replace(/[^\w.\-]+/g, "_");
  const name = [safe(meta.job_no), safe(meta.item_no)].filter(Boolean).join("_") || "cad-job";
  return { file: new File([JSON.stringify(job)], `${name}_rev${meta.rev}.json`, { type: "application/json" }), meta, missingImages };
}
