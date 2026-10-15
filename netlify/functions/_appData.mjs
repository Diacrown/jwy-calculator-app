// Shared server-side logic for the calculator's price / rate tables.
//
//  * DEFAULT_DATA (src/defaultData.js) is the permanent built-in copy.
//  * The developer console can store a replacement for any table ("override").
//  * effectiveData() = built-in values with any overrides laid on top.
//  * Every override is validated here before it is stored, so a typo can never
//    put a table into a shape that would break the calculator.
import { DEFAULT_DATA } from "../../src/defaultData.js";
import { FANCY_GRADE_ORDER } from "../../src/fancyPrices.js";

export const NATURAL_GRADES = ["TW VS", "TW SI1", "TW SI2", "TW SI3", "TW I1", "WH SI", "IJ SI2-I1"];
export const METAL_CODES = ["AU", "PT", "PD", "AG"];
export const ALLOY_METALS = ["WX", "AY", "AU", "PT", "PD", "AG"];
export const CAD_LEVELS = ["None", "Simple", "Medium", "Complex", "Advanced"];

// Names of the tables the console can override.
export const TABLES = [
  "metalPolicy",
  "alloys",
  "currency",
  "locations",
  "labor",
  "settingTiers",
  "naturalPrices",
  "fancyPrices",
  "labGrownPrices",
];

/* ---------- small checking helpers ---------- */
class Bad extends Error {}
const bad = (msg) => {
  throw new Bad(msg);
};
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function num(v, label, { min = 0, max = Infinity, gt = null } = {}) {
  if (v === "" || v === null || v === undefined || typeof v === "boolean") bad(`${label}: a number is required`);
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${label}: "${v}" is not a number`);
  if (n < min) bad(`${label}: must be at least ${min}`);
  if (n > max) bad(`${label}: must be at most ${max}`);
  if (gt !== null && !(n > gt)) bad(`${label}: must be greater than ${gt}`);
  return n;
}
function text(v, label, max = 80) {
  const s = String(v ?? "").trim();
  if (!s) bad(`${label}: cannot be empty`);
  if (s.length > max) bad(`${label}: too long (max ${max} characters)`);
  return s;
}
function arr(v, label, min, max) {
  if (!Array.isArray(v)) bad(`${label}: must be a list`);
  if (v.length < min) bad(`${label}: needs at least ${min} row${min === 1 ? "" : "s"}`);
  if (v.length > max) bad(`${label}: too many rows (max ${max})`);
  return v;
}

/* ---------- per-table validators: return the cleaned value or throw ---------- */
const validators = {
  metalPolicy(v) {
    if (!isObj(v)) bad("Metal policy must be an object");
    const out = {};
    for (const code of METAL_CODES) {
      const r = v[code];
      if (!isObj(r)) bad(`Metal policy: ${code} is missing`);
      out[code] = {
        wastage: num(r.wastage, `${code} wastage`, { gt: 0, max: 10 }),
        spotSurcharge: num(r.spotSurcharge, `${code} spot surcharge`, { gt: 0, max: 5 }),
      };
    }
    return out;
  },

  alloys(v) {
    const rows = arr(v, "Alloys", 1, 200);
    const seen = new Set();
    return rows.map((r, i) => {
      const at = `Alloy row ${i + 1}`;
      if (!isObj(r)) bad(`${at}: invalid row`);
      const short = text(r.short, `${at} short name`, 30);
      if (seen.has(short.toLowerCase())) bad(`${at}: short name "${short}" is used twice`);
      seen.add(short.toLowerCase());
      const metal = String(r.metal ?? "").trim().toUpperCase();
      if (!ALLOY_METALS.includes(metal)) bad(`${at}: metal must be one of ${ALLOY_METALS.join(", ")}`);
      return {
        name: text(r.name, `${at} name`, 80),
        short,
        sg: num(r.sg, `${at} specific gravity`, { gt: 0, max: 30 }),
        purity: num(r.purity, `${at} purity`, { gt: 0, max: 1 }),
        metal,
        castingGm: num(r.castingGm, `${at} casting/gm`, { max: 1000 }),
        minGms: num(r.minGms, `${at} min grams`, { max: 1000 }),
        surchargeGm: num(r.surchargeGm, `${at} surcharge/gm`, { max: 1000 }),
      };
    });
  },

  currency(v) {
    if (!isObj(v) || !isObj(v.rates)) bad("Currency: rates are missing");
    const mode = v.mode === "manual" ? "manual" : v.mode === "live" ? "live" : bad('Currency: mode must be "live" or "manual"');
    const rates = {};
    for (const [k, val] of Object.entries(v.rates)) {
      const code = k.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) bad(`Currency: "${k}" is not a 3-letter code`);
      rates[code] = num(val, `${code} rate`, { gt: 0, max: 100000 });
    }
    if (rates.USD !== 1) bad("Currency: USD must be exactly 1");
    return { mode, markup: num(v.markup, "Markup", { min: 0.5, max: 3 }), rates };
  },

  locations(v) {
    const rows = arr(v, "Locations", 1, 100);
    const seen = new Set();
    return rows.map((r, i) => {
      const at = `Location row ${i + 1}`;
      if (!isObj(r)) bad(`${at}: invalid row`);
      const code = text(r.code, `${at} code`, 30);
      if (seen.has(code.toLowerCase())) bad(`${at}: code "${code}" is used twice`);
      seen.add(code.toLowerCase());
      const currency = String(r.currency ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) bad(`${at}: currency must be a 3-letter code`);
      return { code, currency, duty: num(r.duty, `${at} duty (e.g. 0.05 for 5%)`, { max: 1 }) };
    });
  },

  labor(v) {
    if (!isObj(v) || !isObj(v.cadFees)) bad("Labor & CAD: values are missing");
    const cadFees = {};
    for (const lvl of CAD_LEVELS) cadFees[lvl] = num(v.cadFees[lvl], `CAD fee "${lvl}"`, { max: 100000 });
    return {
      laborPerGm: num(v.laborPerGm, "Labor per gm", { max: 10000 }),
      laborMinFlat: num(v.laborMinFlat, "Minimum labor", { max: 100000 }),
      cadFees,
    };
  },

  settingTiers(v) {
    const rows = arr(v, "Setting tiers", 1, 30);
    let prev = -Infinity;
    const out = rows.map((r, i) => {
      const at = `Setting tier ${i + 1}`;
      if (!isObj(r)) bad(`${at}: invalid row`);
      const uptoCt = num(r.uptoCt, `${at} "up to ct"`, { gt: 0, max: 1000 });
      if (uptoCt <= prev) bad(`${at}: "up to ct" must be larger than the tier above it`);
      prev = uptoCt;
      const type = String(r.type ?? "").trim().toUpperCase();
      if (type !== "PER PC" && type !== "PER CT") bad(`${at}: type must be PER PC or PER CT`);
      return { uptoCt, rate: num(r.rate, `${at} rate`, { max: 100000 }), type };
    });
    if (out[out.length - 1].uptoCt < 10) bad("Setting tiers: the last tier must cover large stones (up to 10 ct or more, e.g. 99)");
    return out;
  },

  naturalPrices(v) {
    if (!isObj(v)) bad("Natural prices must be a table");
    const out = {};
    for (const [k, grid] of Object.entries(v)) {
      const group = k.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,8}$/.test(group)) bad(`Natural prices: size group "${k}" is not valid`);
      if (!isObj(grid)) bad(`Natural prices: ${group} is invalid`);
      const g = {};
      for (const grade of NATURAL_GRADES) {
        if (grid[grade] === undefined || grid[grade] === null || grid[grade] === "") continue; // grade not sold at this size
        g[grade] = num(grid[grade], `${group} ${grade}`, { gt: 0, max: 1000000 });
      }
      if (!Object.keys(g).length) bad(`Natural prices: ${group} has no prices`);
      out[group] = g;
    }
    // Every size group the calculator already knows must stay priced.
    for (const group of Object.keys(DEFAULT_DATA.naturalPrices)) {
      if (!out[group]) bad(`Natural prices: size group ${group} cannot be removed (the calculator uses it)`);
    }
    return out;
  },

  fancyPrices(v) {
    if (!isObj(v)) bad("Fancy prices must be a table");
    const out = {};
    for (const [k, grid] of Object.entries(v)) {
      const code = k.trim();
      if (!/^[A-Za-z0-9.\-]{2,20}$/.test(code)) bad(`Fancy prices: size code "${k}" is not valid`);
      if (!isObj(grid)) bad(`Fancy prices: ${code} is invalid`);
      const g = {};
      for (const grade of FANCY_GRADE_ORDER) {
        if (grid[grade] === undefined || grid[grade] === null || grid[grade] === "") continue;
        g[grade] = num(grid[grade], `${code} ${grade}`, { gt: 0, max: 1000000 });
      }
      if (!Object.keys(g).length) bad(`Fancy prices: ${code} has no prices`);
      out[code] = g;
    }
    if (!Object.keys(out).length) bad("Fancy prices: the table cannot be empty");
    return out;
  },

  labGrownPrices(v) {
    const rows = arr(v, "Lab grown prices", 1, 100);
    const opt = (x, label) => (x === null || x === undefined || x === "" ? null : num(x, label, { gt: 0, max: 1000000 }));
    return rows.map((r, i) => {
      const at = `Lab grown row ${i + 1}`;
      if (!isObj(r)) bad(`${at}: invalid row`);
      const minCt = num(r.minCt, `${at} min ct`, { max: 1000 });
      const maxCt = num(r.maxCt, `${at} max ct`, { max: 1000 });
      if (maxCt < minCt) bad(`${at}: max ct is smaller than min ct`);
      return {
        shape: text(r.shape, `${at} shape`, 20).toUpperCase(),
        minCt,
        maxCt,
        dvvs2: opt(r.dvvs2, `${at} D/VVS2`),
        dvs1: opt(r.dvs1, `${at} D/VS1`),
        nonCert: opt(r.nonCert, `${at} Non-cert`),
      };
    }).sort((a, b) => a.minCt - b.minCt);
  },
};

/* ---------- built-in value of each table, in "override" shape ---------- */
export function defaultTable(name) {
  const d = DEFAULT_DATA;
  switch (name) {
    case "metalPolicy": return d.metalPolicy;
    case "alloys": return d.alloys;
    case "currency": return { mode: d.currencyMode, markup: d.currencyMarkup, rates: d.currencyRates };
    case "locations": return d.locations;
    case "labor": return { laborPerGm: d.laborPerGm, laborMinFlat: d.laborMinFlat, cadFees: d.cadFees };
    case "settingTiers": return d.settingTiers;
    case "naturalPrices": return d.naturalPrices;
    case "fancyPrices": return d.fancyPrices;
    case "labGrownPrices": return d.labGrownPrices;
    default: return undefined;
  }
}

/** Validates one table. Returns { ok:true, value } or { ok:false, error }. */
export function validateTable(name, value, overrides = {}) {
  if (!TABLES.includes(name)) return { ok: false, error: `Unknown table "${name}"` };
  try {
    const clean = validators[name](value);
    // Cross-checks: a location must never use a currency that has no rate.
    const eff = (n) => (n === name ? clean : overrides[n] ? overrides[n].value : defaultTable(n));
    if (name === "currency" || name === "locations") {
      const rates = eff("currency").rates;
      for (const loc of eff("locations")) {
        if (loc.currency !== "USD" && !(rates[loc.currency] > 0)) {
          bad(`Location "${loc.code}" uses ${loc.currency}, which has no rate in the Currency table`);
        }
      }
    }
    return { ok: true, value: clean };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}

/* ---------- storage ---------- */
// overrides document: { version, tables: { name: { value, updatedAt } } }
export const emptyOverrides = () => ({ version: 0, tables: {} });

export async function readOverrides(store) {
  try {
    const doc = await store.get("overrides", { type: "json" });
    if (doc && isObj(doc.tables)) return { version: Number(doc.version) || 0, tables: doc.tables };
  } catch {
    /* treat unreadable storage as "no overrides": built-ins apply */
  }
  return emptyOverrides();
}

/** Built-in data with the stored overrides laid on top (invalid stored data is ignored). */
export function effectiveTables(overrides) {
  const out = {};
  const source = {};
  for (const name of TABLES) {
    const o = overrides.tables[name];
    const check = o ? validateTable(name, o.value, overrides.tables) : null;
    if (o && check.ok) {
      out[name] = check.value;
      source[name] = "developer";
    } else {
      out[name] = defaultTable(name);
      source[name] = "built-in";
    }
  }
  return { tables: out, source };
}

/** Table values reshaped to what the calculator keeps in state. */
export function toCalculatorShape(tables) {
  return {
    metalPolicy: tables.metalPolicy,
    alloys: tables.alloys,
    currencyRates: tables.currency.rates,
    currencyMarkup: tables.currency.markup,
    locations: tables.locations,
    laborPerGm: tables.labor.laborPerGm,
    laborMinFlat: tables.labor.laborMinFlat,
    cadFees: tables.labor.cadFees,
    settingTiers: tables.settingTiers,
    naturalPrices: tables.naturalPrices,
    fancyPrices: tables.fancyPrices,
    labGrownPrices: tables.labGrownPrices,
  };
}

/* ---------- live FX (free ECB-based feed, no key) ---------- */
export const FX_URL = (symbols) => `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols.join(",")}`;
const FX_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Live USD->currency rates for the given codes. Returns { rates, date, fetchedAt, stale } or null.
 * Keeps the last good copy in storage so a feed outage never breaks pricing.
 */
export async function liveFx(store, codes, fetchImpl = fetch, now = Date.now()) {
  const want = codes.filter((c) => c !== "USD");
  if (!want.length) return { rates: { USD: 1 }, date: null, fetchedAt: new Date(now).toISOString(), stale: false };
  const complete = (r) => r && want.every((c) => Number(r[c]) > 0);
  let cached = null;
  try { cached = await store.get("fx-latest", { type: "json" }); } catch {}
  if (cached && complete(cached.rates) && now - Date.parse(cached.fetchedAt) < FX_MAX_AGE_MS) return { ...cached, stale: false };
  try {
    const res = await fetchImpl(FX_URL(want));
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const j = await res.json();
    if (!complete(j && j.rates)) throw new Error("FX response incomplete");
    const fresh = { rates: { USD: 1, ...Object.fromEntries(want.map((c) => [c, Number(j.rates[c])])) }, date: j.date || null, fetchedAt: new Date(now).toISOString() };
    try { await store.setJSON("fx-latest", fresh); } catch {}
    return { ...fresh, stale: false };
  } catch {
    if (cached && complete(cached.rates)) return { ...cached, stale: true };
    return null;
  }
}
