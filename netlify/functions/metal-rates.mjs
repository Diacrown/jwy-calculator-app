import { getStore } from "@netlify/blobs";
import { METALS, londonNow, fetchSpot } from "./_metalPolicy.mjs";

// Live metal rates for the calculator, in the same shape the Google Sheet's
// MetalRates tab produced: { AU: { label, pmRateOz, spotOz, spotSurcharge,
// wastage, asOf }, ... }.
//   spotOz   = live spot from gold-api.com (no key needed)
//   pmRateOz = snapshot of spot taken at the LBMA fix time (metal-pm-snapshot),
//              unless a developer override exists (see metal-rates-admin);
//              before any snapshot exists it falls back to the live spot.
// If the live call fails, the last good payload is served from Blob storage.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async () => {
  const store = getStore("metal-rates-cache");
  try {
    const snap = (await store.get("pm-snapshot", { type: "json" }).catch(() => null)) || {};
    const override = (await store.get("pm-override", { type: "json" }).catch(() => null)) || {};
    const now = londonNow();
    const rates = {};
    for (const [code, m] of Object.entries(METALS)) {
      const spot = await fetchSpot(m.symbol);
      const ov = override[code] && Number(override[code].price) > 0 ? override[code] : null;
      const s = snap[code];
      let pm = spot, pmSource = "spot-fallback", asOf = `${now.label} (live)`;
      if (ov) { pm = Number(ov.price); pmSource = "override"; asOf = ov.label || now.label; }
      else if (s && Number(s.price) > 0) { pm = Number(s.price); pmSource = "snapshot"; asOf = `${s.label} PM`; }
      rates[code] = {
        label: m.label,
        pmRateOz: pm,
        spotOz: spot,
        spotSurcharge: m.spotSurcharge,
        wastage: m.wastage,
        asOf,
        pmSource,
      };
    }
    const payload = { rates, fetchedAt: new Date().toISOString() };
    await store.setJSON("latest", payload);
    return json({ ...payload, source: "live" });
  } catch (err) {
    try {
      const cached = await store.get("latest", { type: "json" });
      if (cached) return json({ ...cached, source: "cache", warning: `Live fetch failed (${err.message}); serving rates from ${cached.fetchedAt}` });
    } catch {}
    return json({ error: `Live fetch failed and no cached rates exist: ${err.message}` }, 502);
  }
};
