// Calculator settings.
//
// All price / rate tables now come from the app's own data service
// (netlify/functions/app-data.mjs) with a permanent built-in copy in
// src/defaultData.js -- there is no Google Sheet any more. Values are changed
// from the hidden developer console (open the site with #/developer on the end
// of the address; it needs the developer token).

// How often (ms) the app re-fetches the data tables and live rates while open.
export const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Live precious-metal rates from our own Netlify function
// (/.netlify/functions/metal-rates): spot from gold-api.com, PM rate from a
// snapshot of spot taken at each LBMA fix time (or a rate typed in the developer
// console). If the function is unreachable the app keeps the last good rates and
// then the built-in sample rates. Set false to always use the built-in sample rates.
export const USE_LIVE_METAL_RATES = true;
