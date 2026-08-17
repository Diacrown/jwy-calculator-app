import { getStore } from "@netlify/blobs";

// Live metal rates -- primary source is GoldAPI.io (direct USD/oz price,
// no inversion math required, which is why it was chosen over similarly
// named services that return an inverted rate and are easy to
// misinterpret). Falls back to the last successfully-fetched value,
// cached in Blob storage, if the live call ever fails.
//
// NOT WIRED INTO THE LIVE APP YET -- built and ready to test, pending
// stakeholder approval, per your instruction. sheetData.js/config.js
// still drive the app's real metal rates until that approval happens.
//
// Requires GOLDAPI_KEY set in Netlify's environment variables.

const METALS = ["XAU", "XAG", "XPT", "XPD"]; // Gold, Silver, Platinum, Palladium
const METAL_KEY = { XAU: "AU", XAG: "AG", XPT: "PT", XPD: "PD" }; // matches ALLOYS' metal codes in JwyCalculator.jsx
const METAL_LABEL = { XAU: "Gold", XAG: "Silver", XPT: "Platinum", XPD: "Palladium" };

// Business policy values, NOT market data -- the live API only supplies
// the raw spot price. These represent your own markup/wastage
// convention layered on top of it, same as the Google Sheet's columns
// today. Defaults here match sheetData.js's own fallback defaults;
// CONFIRM these are actually correct for each metal before relying on
// this in production -- don't assume the defaults are right.
const SPOT_SURCHARGE_DEFAULT = 1.05;
const WASTAGE_DEFAULT = 1;

async function fetchLiveRates(apiKey) {
  const results = {};
  for (const symbol of METALS) {
    const res = await fetch(`https://www.goldapi.io/api/${symbol}/USD`, {
      headers: { "x-access-token": apiKey },
    });
    if (!res.ok) {
      throw new Error(`GoldAPI request for ${symbol} failed (${res.status})`);
    }
    const data = await res.json();
    if (typeof data.price !== "number") {
      throw new Error(`GoldAPI response for ${symbol} missing a price`);
    }
    const key = METAL_KEY[symbol];
    results[key] = {
      label: METAL_LABEL[symbol],
      pmRateOz: data.price,
      spotOz: data.price,
      spotSurcharge: SPOT_SURCHARGE_DEFAULT,
      wastage: WASTAGE_DEFAULT,
      asOf: new Date().toISOString(),
    };
  }
  return results;
}

export default async () => {
  const apiKey = process.env.GOLDAPI_KEY;
  const store = getStore("metal-rates-cache");

  if (!apiKey) {
    // No key configured -- try the cache anyway, so this doesn't hard-fail
    // just because setup isn't finished yet.
    try {
      const cached = await store.get("latest", { type: "json" });
      if (cached) {
        return new Response(JSON.stringify({ ...cached, source: "cache", warning: "GOLDAPI_KEY not configured -- serving cached data" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
    return new Response(
      JSON.stringify({ error: "GOLDAPI_KEY is not configured yet, and no cached data exists." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const rates = await fetchLiveRates(apiKey);
    const payload = { rates, fetchedAt: new Date().toISOString() };
    // Cache this success for next time the live call fails.
    await store.setJSON("latest", payload);
    return new Response(JSON.stringify({ ...payload, source: "live" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Live fetch failed -- fall back to last known good.
    try {
      const cached = await store.get("latest", { type: "json" });
      if (cached) {
        return new Response(
          JSON.stringify({
            ...cached,
            source: "cache",
            warning: `Live fetch failed (${err.message}) -- serving last cached rates from ${cached.fetchedAt}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    } catch {}
    return new Response(
      JSON.stringify({ error: `Live fetch failed and no cached data exists: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
