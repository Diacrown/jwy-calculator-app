// Metal definitions. Wastage and spot surcharge are business settings (not market
// data): their built-in values live in src/defaultData.js and can be changed from
// the developer console ("metalPolicy" table); this file only adds the market-side
// facts (feed symbol, LBMA fix time).
import { DEFAULT_METAL_POLICY } from "../../src/defaultData.js";

const P = DEFAULT_METAL_POLICY;
export const METALS = {
  AU: { symbol: "XAU", label: "Gold", wastage: P.AU.wastage, spotSurcharge: P.AU.spotSurcharge, fixLondon: "15:00" }, // LBMA Gold PM
  PT: { symbol: "XPT", label: "Platinum", wastage: P.PT.wastage, spotSurcharge: P.PT.spotSurcharge, fixLondon: "14:00" }, // LBMA Platinum PM
  PD: { symbol: "XPD", label: "Palladium", wastage: P.PD.wastage, spotSurcharge: P.PD.spotSurcharge, fixLondon: "14:00" }, // LBMA Palladium PM
  AG: { symbol: "XAG", label: "Silver", wastage: P.AG.wastage, spotSurcharge: P.AG.spotSurcharge, fixLondon: "12:00" }, // LBMA Silver price
};

// Free spot feed (no key). Returns { price } in USD per troy ounce.
export const SPOT_URL = (symbol) => `https://api.gold-api.com/price/${symbol}`;

// How long (minutes) after the fix time a scheduled run may still capture it.
export const FIX_WINDOW_MIN = 30;

// Wall-clock parts in London time (handles BST/GMT automatically).
export function londonNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hh = parseInt(p.hour, 10) % 24;
  const mm = parseInt(p.minute, 10);
  return {
    weekday: p.weekday, day: p.day, month: p.month, year: p.year,
    minutesOfDay: hh * 60 + mm,
    dateKey: `${p.year}-${p.month}-${p.day}`,
    label: `${p.weekday} ${p.day} ${p.month} ${p.year}`,
  };
}
export const fixMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Fetch one metal's spot; throws if the response is not a sane positive number.
export async function fetchSpot(symbol, fetchImpl = fetch) {
  const res = await fetchImpl(SPOT_URL(symbol));
  if (!res.ok) throw new Error(`gold-api ${symbol} HTTP ${res.status}`);
  const j = await res.json();
  const price = Number(j && j.price);
  if (!isFinite(price) || price <= 0) throw new Error(`gold-api ${symbol} returned no price`);
  return price;
}
