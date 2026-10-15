// Fetches the calculator's price / rate tables from the data service
// (netlify/functions/app-data.mjs). This replaces the old Google Sheet fetch.
//
// Returns { data, sources, errors }:
//   data     only the fields that arrived AND passed the checks below (anything
//            else is simply absent, so the caller keeps the values it already has)
//   sources  per table: "built-in" | "developer" | "live-fx" | "live-fx-cache"
//   errors   per table: what was wrong with it (those tables keep their old values)
// Throws if the service itself cannot be reached.
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const posNum = (v) => typeof v === "number" && isFinite(v) && v > 0;
const okNum = (v) => typeof v === "number" && isFinite(v) && v >= 0;

const CHECKS = {
  alloys: (v) =>
    Array.isArray(v) && v.length > 0 &&
    v.every((a) => isObj(a) && typeof a.short === "string" && a.short && typeof a.metal === "string" && posNum(a.purity) && posNum(a.sg) && okNum(a.castingGm) && okNum(a.surchargeGm) && okNum(a.minGms)),
  currencyRates: (v) => isObj(v) && v.USD === 1 && Object.values(v).every(posNum),
  currencyMarkup: posNum,
  locations: (v) =>
    Array.isArray(v) && v.length > 0 && v.every((l) => isObj(l) && typeof l.code === "string" && l.code && typeof l.currency === "string" && okNum(l.duty)),
  laborPerGm: okNum,
  laborMinFlat: okNum,
  cadFees: (v) => isObj(v) && ["None", "Simple", "Medium", "Complex", "Advanced"].every((k) => okNum(v[k])),
  settingTiers: (v) => Array.isArray(v) && v.length > 0 && v.every((t) => isObj(t) && posNum(t.uptoCt) && okNum(t.rate) && typeof t.type === "string"),
  naturalPrices: (v) => isObj(v) && Object.keys(v).length > 0 && Object.values(v).every((g) => isObj(g) && Object.values(g).every(posNum)),
  fancyPrices: (v) => isObj(v) && Object.keys(v).length > 0 && Object.values(v).every((g) => isObj(g) && Object.values(g).every(posNum)),
  labGrownPrices: (v) => Array.isArray(v) && v.length > 0 && v.every((b) => isObj(b) && typeof b.shape === "string" && okNum(b.minCt) && okNum(b.maxCt)),
};
// which table (as named in the status panel) each field belongs to
const TABLE_OF = {
  alloys: "alloys", currencyRates: "currencyRates", currencyMarkup: "currencyRates", locations: "locations",
  laborPerGm: "cadFeesAndLabor", laborMinFlat: "cadFeesAndLabor", cadFees: "cadFeesAndLabor",
  settingTiers: "settingTiers", naturalPrices: "naturalPrices", fancyPrices: "fancyPrices", labGrownPrices: "labGrownPrices",
};

export async function fetchAppData() {
  const res = await fetch("/.netlify/functions/app-data", { cache: "no-store" });
  if (!res.ok) throw new Error("Data service answered " + res.status);
  const payload = await res.json();
  if (!payload || !isObj(payload.data)) throw new Error("Data service sent an unexpected reply");
  const data = {};
  const errors = {};
  for (const [field, check] of Object.entries(CHECKS)) {
    const value = payload.data[field];
    if (check(value)) data[field] = value;
    else errors[TABLE_OF[field]] = "received invalid data, keeping the previous values";
  }
  return { data, sources: isObj(payload.sources) ? payload.sources : {}, errors };
}
