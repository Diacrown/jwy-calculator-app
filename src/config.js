// Paste your six published-CSV URLs here after building the sheet per
// SHEET_SPEC.md. Each is File > Share > Publish to web > select tab >
// CSV > Publish > copy URL. Leave any blank to fall back to the bundled
// sample data for that table (useful for local dev before the sheet
// exists, or if you intentionally want a table to stay code-managed).
//
// Once all six are filled in, the app needs zero human interaction to
// stay current -- it polls these URLs on an interval and recalculates.

// Using Google's gviz/tq endpoint rather than the "Publish to web" /pub
// CSV links. Both expose the same published data, but /pub frequently
// omits CORS headers needed for cross-origin fetch() from another site
// (it works fine opened directly in a browser tab, which is misleading --
// that's plain navigation, not a fetch, so CORS never applies there).
// gviz/tq is Google's own endpoint for exactly this use case and reliably
// supports cross-origin reads. It requires the sheet's general access to
// be "Anyone with the link — Viewer" (Share button, not just Publish to
// web) since it reads live off the actual document permissions.
const SHEET_ID = "1wPI7Ujbc9F4GEarje0BbCnUXVYKwyCa_vyqtB3mbciE";
const gvizUrl = (gid) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;

export const SHEET_URLS = {
  metalRates: gvizUrl(0), // Tab 1: MetalRates
  alloys: gvizUrl(1405483371), // Tab 2: Alloys
  currencyRates: gvizUrl(1536480790), // Tab 3: CurrencyRates
  locations: gvizUrl(1786149102), // Tab 4: Locations
  cadFeesAndLabor: gvizUrl(386901877), // Tab 5: CadFeesAndLabor
  settingTiers: gvizUrl(1907251116), // Tab 6: SettingTiers
};

// How often (ms) the app re-fetches all six sheets while open.
export const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
