// Paste your six published-CSV URLs here after building the sheet per
// SHEET_SPEC.md. Each is File > Share > Publish to web > select tab >
// CSV > Publish > copy URL. Leave any blank to fall back to the bundled
// sample data for that table (useful for local dev before the sheet
// exists, or if you intentionally want a table to stay code-managed).
//
// Once all six are filled in, the app needs zero human interaction to
// stay current -- it polls these URLs on an interval and recalculates.

export const SHEET_URLS = {
  metalRates: "", // Tab 1: MetalRates
  alloys: "", // Tab 2: Alloys
  currencyRates: "", // Tab 3: CurrencyRates
  locations: "", // Tab 4: Locations
  cadFeesAndLabor: "", // Tab 5: CadFeesAndLabor
  settingTiers: "", // Tab 6: SettingTiers
};

// How often (ms) the app re-fetches all six sheets while open.
export const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
