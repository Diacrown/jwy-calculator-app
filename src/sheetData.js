import { SHEET_URLS } from "./config.js";

/* ============================================================
   Minimal CSV parser. Handles quoted fields with embedded commas,
   which Google's published-CSV export can produce for labels/names.
   ============================================================ */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
    return obj;
  });
}

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : fallback;
};

// Normalizes a header for comparison: lowercase, strip everything that
// isn't a letter or digit. This makes "PM Rate/Oz", "pm_rate_oz", and
// "pmRateOz" all match the same alias -- people naturally paste in
// whatever headers their existing sheet already uses.
function normHeader(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Finds the first column in a row whose header matches any of the given
// aliases (order = priority). Both the app's own short names (metal,
// pmRateOz...) and real-world sheet headers (Metal Type, PM Rate/Oz...)
// are listed as aliases so either naming style works without the user
// renaming their columns.
function pick(row, aliases) {
  const keys = Object.keys(row);
  const normKeys = keys.map(normHeader);
  for (const alias of aliases) {
    const idx = normKeys.indexOf(normHeader(alias));
    if (idx !== -1) return row[keys[idx]];
  }
  return undefined;
}

async function fetchCsvObjects(url) {
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Sheet fetch failed: " + res.status + " (" + url + ")");
  const text = await res.text();
  return rowsToObjects(parseCsv(text));
}

/* ============================================================
   Per-tab transformers: raw CSV rows -> the shape the calculator
   engine expects. Each field lists both the plain template header
   and the real MetalMaster/Master-sheet header it may appear as.
   ============================================================ */

function transformMetalRates(rawRows) {
  const out = {};
  for (const r of rawRows) {
    const metal = pick(r, ["metal", "Metal Type"]);
    if (!metal) continue;
    out[metal.trim().toUpperCase()] = {
      label: pick(r, ["label", "Rate Type"]) || metal,
      pmRateOz: num(pick(r, ["pmRateOz", "PM Rate/Oz", "PM Rate Oz"])),
      spotOz: num(pick(r, ["spotOz", "SpotRate", "Spot Rate"])),
      spotSurcharge: num(pick(r, ["spotSurcharge", "SpotSurcharge", "Spot Surcharge"]), 1.05),
      wastage: num(pick(r, ["wastage", "Wastage"]), 1),
      asOf: pick(r, ["asOf", "PM Rate As On", "Rate As On"]) || "",
    };
  }
  return out;
}

function transformAlloys(rawRows) {
  return rawRows
    .map((r) => {
      const short = pick(r, ["short", "Alloy Short Name"]);
      if (!short) return null;
      const minGmsRaw = pick(r, ["minGms", "Min Gms", "Min Gm"]);
      return {
        name: pick(r, ["name", "Alloy Name"]) || short,
        short: short.trim(),
        sg: num(pick(r, ["sg", "Specific Gravity"])),
        purity: num(pick(r, ["purity", "Purity"])),
        metal: (pick(r, ["metal", "Metal Type"]) || "").trim().toUpperCase(),
        castingGm: num(pick(r, ["castingGm", "Casting/Gm", "Casting Gm"])),
        surchargeGm: num(pick(r, ["surchargeGm", "Surcharge/Gm", "Surcharge Gm"])),
        minGms: minGmsRaw !== undefined && minGmsRaw !== "" ? num(minGmsRaw, 7.0) : 7.0,
      };
    })
    .filter(Boolean);
}

function transformCurrencyRates(rawRows) {
  const out = {};
  let markup = 1.05;
  for (const r of rawRows) {
    // Template layout: currency, rateToUSD, markup
    // Original "Other Master" layout: USD | to | <currency> | <rate> | <rate*markup>
    let currency = pick(r, ["currency"]);
    let rate = pick(r, ["rateToUSD"]);
    let mk = pick(r, ["markup"]);
    if (!currency) {
      // Fall back to positional original layout (3rd column = currency
      // code, 4th = raw rate, 5th = rate with markup already applied).
      const vals = Object.values(r);
      if (vals.length >= 4) {
        currency = vals[2];
        rate = vals[3];
        if (vals.length >= 5 && num(vals[3]) > 0) {
          mk = num(vals[4]) / num(vals[3]);
        }
      }
    }
    if (!currency) continue;
    out[String(currency).trim().toUpperCase()] = num(rate, 1);
    if (mk) markup = num(mk, markup);
  }
  return { rates: out, markup };
}

function transformLocations(rawRows) {
  return rawRows
    .map((r) => {
      const code = pick(r, ["code", "Loc"]);
      if (!code) return null;
      const dutyRaw = pick(r, ["duty", "Duty%", "Duty"]);
      let duty = num(dutyRaw);
      // "5.00%" style values: if it parses >1 assume it was a percent.
      if (duty > 1) duty = duty / 100;
      return {
        code: code.trim(),
        currency: (pick(r, ["currency", "Currency"]) || "USD").trim().toUpperCase(),
        duty,
      };
    })
    .filter(Boolean);
}

function transformCadFeesAndLabor(rawRows) {
  const map = {};
  for (const r of rawRows) {
    const key = pick(r, ["key"]);
    const value = pick(r, ["value"]);
    if (key) {
      map[key.trim()] = num(value);
      continue;
    }
    // Original layout has no "key" column -- it's a label + blanks +
    // value row, e.g. "Labor charges per gm | | | $22.00 /gm". Match by
    // the label text in the first non-empty cell instead.
    const cells = Object.values(r).map((v) => (v || "").trim());
    const labelCell = cells.find((c) => c) || "";
    const valueCell = [...cells].reverse().find((c) => c) || "";
    const l = labelCell.toLowerCase();
    if (l.includes("labor") && l.includes("per gm")) map.laborPerGm = num(valueCell);
    else if (l.includes("minimum labor")) map.laborMinFlat = num(valueCell);
    else if (l === "none") map.cadNone = num(valueCell);
    else if (l === "simple") map.cadSimple = num(valueCell);
    else if (l === "medium") map.cadMedium = num(valueCell);
    else if (l === "complex") map.cadComplex = num(valueCell);
    else if (l === "advanced") map.cadAdvanced = num(valueCell);
  }
  return {
    laborPerGm: map.laborPerGm ?? 22.0,
    laborMinFlat: map.laborMinFlat ?? 55.0,
    cadFees: {
      None: map.cadNone ?? 0,
      Simple: map.cadSimple ?? 50,
      Medium: map.cadMedium ?? 75,
      Complex: map.cadComplex ?? 100,
      Advanced: map.cadAdvanced ?? 200,
    },
  };
}

function transformSettingTiers(rawRows) {
  return rawRows
    .map((r) => {
      const uptoRaw = pick(r, ["uptoCt", "Upto Ct Wt/Pc", "Upto Ct"]);
      if (!uptoRaw) return null;
      return {
        uptoCt: num(uptoRaw),
        rate: num(pick(r, ["rate", "Rate"])),
        type: (pick(r, ["type", "Rate Type"]) || "PER PC").trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.uptoCt - b.uptoCt);
}
function transformLabGrownPrices(rawRows) {
  const out = {};
  for (const r of rawRows) {
    const code = pick(r, ["code", "Code"]); // Adjust header aliases if needed
    const price = pick(r, ["price", "Price"]);
    if (code) out[code.trim().toUpperCase()] = num(price);
  }
  return out;
}

function transformNaturalPrices(rawRows) {
  const codeToGroupMap = {};
  const groupToPriceMap = {};

  for (const r of rawRows) {
    // Dataset 1: Code -> Group
    const c = pick(r, ["code", "Code"]);
    const g = pick(r, ["group", "Group"]);
    if (c && g) codeToGroupMap[c.trim().toUpperCase()] = g.trim();

    // Dataset 2: Group -> Price
    const pg = pick(r, ["priceGroup", "Group"]);
    const pp = pick(r, ["price", "Price"]);
    if (pg && pp) groupToPriceMap[pg.trim()] = num(pp);
  }

  // Combine into final mapping
  const finalMap = {};
  Object.keys(codeToGroupMap).forEach(code => {
    const groupName = codeToGroupMap[code];
    finalMap[code] = groupToPriceMap[groupName] || 0;
  });
  return finalMap;
}
/* ============================================================
   Public entry point: fetch all six tabs in parallel. Any tab
   whose URL is blank, or whose fetch fails, is reported but does
   not block the others -- the caller decides how to fall back.
   ============================================================ */

export async function fetchLiveSheetData() {
  const specs = [
    { key: "metalRates", url: SHEET_URLS.metalRates, transform: transformMetalRates },
    { key: "alloys", url: SHEET_URLS.alloys, transform: transformAlloys },
    { key: "currencyRates", url: SHEET_URLS.currencyRates, transform: transformCurrencyRates },
    { key: "locations", url: SHEET_URLS.locations, transform: transformLocations },
    { key: "cadFeesAndLabor", url: SHEET_URLS.cadFeesAndLabor, transform: transformCadFeesAndLabor },
    { key: "settingTiers", url: SHEET_URLS.settingTiers, transform: transformSettingTiers },
  ];

  const results = {};
  const errors = {};

  await Promise.all(
    specs.map(async ({ key, url, transform }) => {
      if (!url) {
        errors[key] = "not configured";
        return;
      }
      try {
        const raw = await fetchCsvObjects(url);
        results[key] = transform(raw);
      } catch (e) {
        errors[key] = e.message || String(e);
      }
    })
  );

  return { data: results, errors };
}
