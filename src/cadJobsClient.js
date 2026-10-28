// Browser side of the "CAD jobs" list: talks to netlify/functions/cad-jobs.mjs (same site, so no CORS).
// The access key is typed once per browser and kept in localStorage; it is never part of the code.

const ENDPOINT = "/.netlify/functions/cad-jobs";
const KEY_STORE = "jwyCadJobsReadKey";
const PICTURE_PARALLEL = 3;

export function getSavedReadKey() {
  try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; }
}
export function saveReadKey(key) {
  try { localStorage.setItem(KEY_STORE, key); } catch { /* storage blocked: asked again next time */ }
}
export function clearReadKey() {
  try { localStorage.removeItem(KEY_STORE); } catch { /* nothing to clear */ }
}

async function get(key, params) {
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { "x-cad-read-key": key }, cache: "no-store" });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && body.error) || (res.status === 404 ? "CAD job storage is not available on this site yet." : `Request failed (${res.status})`));
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function listCadJobs(key, q) {
  const body = await get(key, `action=list&limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return Array.isArray(body.results) ? body.results : [];
}

// Rebuilds the same .json the CAD form puts in its ZIP (pictures put back in) and returns it as a File,
// so the existing "Load order data" import can read it unchanged.
export async function fetchCadJobFile(key, id) {
  const { meta, job, slots } = await get(key, `action=job&id=${encodeURIComponent(id)}`);
  const lists = { v: Array.isArray(job._VERSIONS) ? job._VERSIONS : [], r: Array.isArray(job._CLIENT_REF_IMAGES) ? job._CLIENT_REF_IMAGES : [] };
  let missingImages = 0;
  const queue = [...(slots || [])];
  const worker = async () => {
    while (queue.length) {
      const slot = queue.shift();
      try {
        const { dataUrl } = await get(key, `action=image&id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`);
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
