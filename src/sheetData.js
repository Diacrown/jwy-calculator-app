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

async function fetchCsvObjects(url) {
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Sheet fetch failed: " + res.status + " (" + url + ")");
  const text = await res.text();
  return rowsToObjects(parseCsv(text));
}

/* ============================================================
   Per-tab transformers: raw CSV rows -> the shape the calculator
   engine expects.
   ============================================================ */

function transformMetalRates(rawRows) {
  const out = {};
  for (const r of rawRows) {
    if (!r.metal) continue;
    out[r.metal.trim().toUpperCase()] = {
      label: r.label || r.metal,
      pmRateOz: num(r.pmRateOz),
      spotOz: num(r.spotOz),
      spotSurcharge: num(r.spotSurcharge, 1.05),
      wastage: num(r.wastage, 1),
      asOf: r.asOf || "",
    };
  }
  return out;
}

function transformAlloys(rawRows) {
  return rawRows
    .filter((r) => r.short)
    .map((r) => ({
      name: r.name || r.short,
      short: r.short.trim(),
      sg: num(r.sg),
      purity: num(r.purity),
      metal: (r.metal || "").trim().toUpperCase(),
      castingGm: num(r.castingGm),
      surchargeGm: num(r.surchargeGm),
    }));
}

function transformCurrencyRates(rawRows) {
  const out = {};
  let markup = 1.05;
  for (const r of rawRows) {
    if (!r.currency) continue;
    out[r.currency.trim().toUpperCase()] = num(r.rateToUSD, 1);
    if (r.markup) markup = num(r.markup, markup);
  }
  return { rates: out, markup };
}

function transformLocations(rawRows) {
  return rawRows
    .filter((r) => r.code)
    .map((r) => ({
      code: r.code.trim(),
      currency: (r.currency || "USD").trim().toUpperCase(),
      duty: num(r.duty),
    }));
}

function transformCadFeesAndLabor(rawRows) {
  const map = {};
  for (const r of rawRows) {
    if (!r.key) continue;
    map[r.key.trim()] = num(r.value);
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
    .filter((r) => r.uptoCt)
    .map((r) => ({
      uptoCt: num(r.uptoCt),
      rate: num(r.rate),
      type: (r.type || "PER PC").trim(),
    }))
    .sort((a, b) => a.uptoCt - b.uptoCt);
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
