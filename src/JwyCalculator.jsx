import { useState, useMemo, useCallback, useEffect } from "react";

const __memStore = { _d: {}, getItem(k){ return k in this._d ? this._d[k] : null; }, setItem(k,v){ this._d[k]=String(v); } };

/* config */
// Paste your six published-CSV URLs here after building the sheet per
// SHEET_SPEC.md. Each is File > Share > Publish to web > select tab >
// CSV > Publish > copy URL. Leave any blank to fall back to the bundled
// sample data for that table (useful for local dev before the sheet
// exists, or if you intentionally want a table to stay code-managed).
//
// Once all six are filled in, the app needs zero human interaction to
// stay current -- it polls these URLs on an interval and recalculates.

const SHEET_URLS = {
  metalRates: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=0&single=true&output=csv", // Tab 1: MetalRates
  alloys: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=1405483371&single=true&output=csv", // Tab 2: Alloys
  currencyRates: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=1536480790&single=true&output=csv", // Tab 3: CurrencyRates
  locations: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=1786149102&single=true&output=csv", // Tab 4: Locations
  cadFeesAndLabor: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=386901877&single=true&output=csv", // Tab 5: CadFeesAndLabor
  settingTiers: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXfsmDWYS82tPGIWDsVB3BAKSmnKhhLgXWaiRRvlqKLJ45d0vTs1yXOb4Vb9u1no7JmtoBJbMTEprH/pub?gid=1907251116&single=true&output=csv", // Tab 6: SettingTiers
};

// How often (ms) the app re-fetches all six sheets while open.
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/* sheetData */


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

async function fetchLiveSheetData() {
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

/* pdfParser */
// CAD Order Form PDF parser.
//
// Your CAD system embeds a clean JSON payload in the PDF's text layer,
// delimited by %%CAD_FORM_DATA_START%% ... %%CAD_FORM_DATA_END%%. We read
// that directly -- no OCR, no fragile visual parsing. This was validated
// against a real production card (job 1234 / S-18934-WER).
//
// Uses pdf.js, loaded from CDN at runtime so there's no build dependency.

const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const START_MARK = "%%CAD_FORM_DATA_START%%";
// LGD "Odd" band per your price sheet: fancy colors + these step/mixed
// cuts route to the ODD row ($250/ct flat). User can override via the
// shape selector on the row if auto-classification is wrong.
const LGD_ODD_SHAPES = [
  "trillion", "trilliant", "triangle", "halfmoon", "half moon", "trapezoid",
  "old cut", "old european", "old miner", "kite", "lozenge", "hexagon",
  "shield", "bullet", "step",
];
function isOddShape(shape) {
  const s = (shape || "").toLowerCase().trim();
  if (!s) return false;
  return LGD_ODD_SHAPES.some((k) => s.includes(k));
}

const END_MARK = "%%CAD_FORM_DATA_END%%";

let pdfjsLoading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(el);
  });
}
function loadPdfJs() {
  // Load BOTH the main library and the worker module as plain script
  // tags. When the worker module is present as a global (pdfjsWorker),
  // pdf.js runs entirely on the main thread -- no Worker creation, no
  // workerSrc fetch. This sidesteps cross-origin and sandboxed-blob
  // restrictions entirely (workers cannot load in some environments).
  if (window.pdfjsLib && window.pdfjsWorker) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = (async () => {
    if (!window.pdfjsLib) await loadScript(PDFJS_SRC);
    if (!window.pdfjsWorker) await loadScript(PDFJS_WORKER);
    if (!window.pdfjsLib) throw new Error("pdf.js failed to initialize");
    return window.pdfjsLib;
  })();
  return pdfjsLoading;
}

async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Join fragments with NOTHING. Injecting newlines here breaks the
    // embedded JSON block (raw control chars inside JSON string values
    // are invalid and make JSON.parse fail).
    text += content.items.map((it) => it.str).join("");
  }
  return text;
}

function escRe(c) {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find a marker even if the extractor injected whitespace between its
// characters (different PDF text extractors fragment text differently).
function findFlexible(text, marker) {
  const pattern = marker.split("").map(escRe).join("[\\s]*");
  const m = new RegExp(pattern).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

// Complete a truncated JSON object: walk it tracking string/escape state
// and brace depth; if it never closes, cut at the last complete top-level
// field and close the root object. Needed because pdf.js stops extracting
// partway through the huge base64 render image that follows the data
// fields, so the end marker (and tail of the JSON) may be missing.
function salvageJson(raw) {
  let depth = 0;
  let inStr = false;
  let lastComma = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return raw.slice(0, i + 1);
    } else if (c === "," && depth === 1) lastComma = i;
  }
  if (lastComma !== -1) return raw.slice(0, lastComma) + "}";
  return null;
}

function extractEmbeddedJson(text) {
  const s = findFlexible(text, START_MARK);
  if (!s) return { data: null, diag: "start marker not found" };
  const e = findFlexible(text, END_MARK);
  let raw = (e && e.start > s.end ? text.slice(s.end, e.start) : text.slice(s.end)).replace(
    /[\u0000-\u001F]/g,
    ""
  );
  const attempts = [];
  attempts.push(raw);
  const salvaged = salvageJson(raw);
  if (salvaged) attempts.push(salvaged);
  for (const a of attempts) {
    try {
      return { data: JSON.parse(a), diag: "" };
    } catch (err) {}
    // whitespace-repair variant: drop spaces outside quoted strings
    let out = "";
    let inStr = false;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (c === '"' && a[i - 1] !== "\\") inStr = !inStr;
      if (!inStr && (c === " " || c === "\t")) continue;
      out += c;
    }
    try {
      return { data: JSON.parse(out), diag: "" };
    } catch (err) {}
  }
  return { data: null, diag: "block found but could not be parsed" };
}

/* ============================================================
   Field mapping: embedded JSON -> calculator state.

   Metals: card has Metal 1, Metal 2, and Stamping. Per your rule,
   the two heavier of the actual construction metals map to Primary
   (heavier) and Secondary (lighter). Stamping is captured but not
   treated as a construction weight unless it carries a gram weight.

   Stones: rounds match to nearest RND DiaSize code by carat weight
   and price normally. Fancy naturals populate specs but are flagged
   (no fancy pricing in DiaSSP). Fancy LGD price from LGD FANCY/ODD
   bands when the weight lands in a band, else flagged.
   ============================================================ */

// Map card metal (type + color) to a calculator alloy short code.
function cardMetalToAlloyShort(type, color) {
  const t = (type || "").toUpperCase().replace("KT", "").trim(); // "09" -> "9"
  const kt = String(parseInt(t, 10)); // normalizes 09 -> 9
  const c = (color || "").toUpperCase().trim();
  const colorMap = { WG: "WG", YG: "YG", RG: "RG", "WG-PD": "WG-PD", "WG-NF": "WG-NF" };
  const suffix = colorMap[c] || c;
  // e.g. "9" + "KT " + "WG" => "9KT WG"; "14" + "RG" => "14KT RG"
  return `${kt}KT ${suffix}`;
}

function pnum(v, d = 0) {
  const n = parseFloat(v);
  return isFinite(n) ? n : d;
}

// Given the card's stone record, decide how the calculator should treat it.
// Returns { diamondMode, sizeCode|null, quality|lgdGrade, priced, flag }.
function bridgeStone(stone, diaSize) {
  const shapeRaw = (stone.Shape || "").toLowerCase();
  const isRound = shapeRaw.includes("round") || shapeRaw === "rnd";
  const isLGD = (stone.Stone || "").toUpperCase().includes("LGD");
  const avgWt = pnum(stone.AvgWt);

  if (isRound) {
    const rounds = diaSize.filter((d) => d.code.startsWith("RND"));
    let best = null, bestDiff = Infinity;
    for (const d of rounds) {
      const diff = Math.abs(d.wt - avgWt);
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    return {
      diamondMode: isLGD ? "lgd" : "natural",
      sizeCode: best ? best.code : "",
      priced: true,
      flag: best ? "" : "no round size match",
    };
  }

  // Fancy LGD: auto-classify ODD shapes (trillion, kite, hexagon,
  // step cuts, etc.) to the ODD band, everything else to FANCY. User
  // can override via the LGD shape selector on the schedule row.
  if (isLGD) {
    const isOdd = isOddShape(stone.Shape);
    const lgdShape = isOdd ? "ODD" : "FANCY";
    const inBand = avgWt >= 0.01 && avgWt <= 3.99;
    return {
      diamondMode: "lgd",
      sizeCode: "",
      lgdShape,
      priced: inBand,
      flag: inBand ? (isOdd ? "auto-classified as ODD — verify" : "") : "LGD below priced bands",
    };
  }

  // Fancy natural: no DiaSSP price. Populate as a custom row so it
  // lands in the schedule with shape / ct / qty; quoter enters $/ct
  // manually until a fancy natural price table is provided.
  const oddNat = isOddShape(stone.Shape);
  return {
    diamondMode: "natural",
    isCustom: true,
    customShape: stone.Shape || "",
    customWt: avgWt,
    priced: false,
    flag: oddNat ? "odd shape — enter $/ct manually" : "fancy natural — enter $/ct manually",
  };
}

async function parseOrderFormPdf(file, { alloys = [], diaSize = [] } = {}) {
  const text = await extractPdfText(file);
  const { data, diag } = extractEmbeddedJson(text);
  if (!data) {
    const snippet = text ? text.slice(0, 160).replace(/\s+/g, " ") : "(no text extracted)";
    return {
      ok: false,
      reason: "no-embedded-data",
      data: null,
      diag: `${diag}; extracted ${text.length} chars; starts: "${snippet}"`,
    };
  }

  // --- Job info ---
  const jobInfo = {
    designer: data["CAD Designer"] || "",
    jobNo: data["JobNo"] || "",
    customer: data["VendorItemNo"] || "", // no explicit customer field; closest proxy
    styleCode: data["Style code"] || "",
    itemNo: data["ItemNo"] || "",
    refNo: data["Ref no"] || "",
    itemType: data["ItemType"] || "",
    subCategory: data["Sub Category"] || "",
    itemSize: data["Item Size"] || "",
    twoTone: data["Two Tone"] || "",
    stamping: data["Stamping"] || "",
    rhodium: data["Rhodium"] || "",
    alloyType: data["Alloy Type"] || "",
    clientNotes: data["Client Notes"] || "",
  };

  // --- Metals (assign by weight, heavier = primary) ---
  const metalCandidates = [
    {
      short: cardMetalToAlloyShort(data["Metal Type 1"], data["Metal Col 1"]),
      wt: pnum(data["Metal 1 Weight"]),
    },
    {
      short: cardMetalToAlloyShort(data["Metal Type 2"], data["Metal Col 2"]),
      wt: pnum(data["Metal 2 Weight"]),
    },
  ].filter((m) => m.wt > 0);
  metalCandidates.sort((a, b) => b.wt - a.wt); // heavier first

  const validShort = (s) => alloys.some((a) => a.short === s);
  const metals = {
    primary: metalCandidates[0] || null,
    secondary: metalCandidates[1] || null,
  };
  const metalWarnings = [];
  if (metals.primary && !validShort(metals.primary.short))
    metalWarnings.push(`Primary metal "${metals.primary.short}" not found in alloy list — check mapping`);
  if (metals.secondary && !validShort(metals.secondary.short))
    metalWarnings.push(`Secondary metal "${metals.secondary.short}" not found in alloy list — check mapping`);

  // --- Stones ---
  const rawStones = Array.isArray(data["_RAW_STONES"]) ? data["_RAW_STONES"] : [];
  const stones = rawStones
    .filter((s) => s.Shape && pnum(s.Qty) > 0)
    .map((s) => {
      const bridge = bridgeStone(s, diaSize);
      return {
        pos: s.Pos || "",
        stoneType: s.Stone || "",
        shape: s.Shape || "",
        dims: [s.L, s.W, s.H].filter(Boolean).join(" x "),
        avgWt: pnum(s.AvgWt),
        qty: pnum(s.Qty),
        totalWt: pnum(s.Tot),
        setting: s.Set || "",
        source: s.Source || "",
        ...bridge,
      };
    });

  return {
    ok: true,
    data: { jobInfo, metals, metalWarnings, stones, rawJson: data },
  };
}

/* main */

/* ============================================================
   REFERENCE DATA
   In production, METAL_RATES and CURRENCY_RATES should be
   replaced by a live fetch (see fetchLiveRates below) pointed
   at a published Google Sheet CSV endpoint.
   ============================================================ */

const SAMPLE_METAL_RATES = {
  AU: { label: "Gold", pmRateOz: 4026.45, spotOz: 3984.96, asOf: "Mon 29 Jun 2026 PM" },
  PT: { label: "Platinum", pmRateOz: 1588.0, spotOz: 1566.5, asOf: "Mon 29 Jun 2026" },
  PD: { label: "Palladium", pmRateOz: 1212.0, spotOz: 1223.0, asOf: "Mon 29 Jun 2026" },
  AG: { label: "Silver", pmRateOz: 57.71, spotOz: 57.52, asOf: "Mon 29 Jun 2026" },
};

const SAMPLE_CURRENCY_RATES = {
  USD: 1.0,
  EUR: 0.93,
  AUD: 1.66,
  NZD: 1.81,
  GBP: 0.8,
  PLN: 4.15,
  INR: 86.5,
};
const CURRENCY_MARKUP = 1.05;

const LOCATIONS = [
  { code: "DMG", currency: "EUR", duty: 0.03 },
  { code: "DMT", currency: "USD", duty: 0.2 },
  { code: "WSME", currency: "AUD", duty: 0.05 },
  { code: "WSSY", currency: "AUD", duty: 0.05 },
  { code: "WSBN", currency: "AUD", duty: 0.05 },
  { code: "WSNZ", currency: "NZD", duty: 0.05 },
  { code: "WSUK", currency: "GBP", duty: 0.02 },
  { code: "WSIT", currency: "EUR", duty: 0.02 },
  { code: "WSPL", currency: "PLN", duty: 0.02 },
  { code: "DMR", currency: "INR", duty: 0.0 },
];

const ALLOYS = [
  { name: "9KT White (Nickel Safe - USA)", short: "9KT WG", sg: 11.0, purity: 0.375, metal: "AU" },
  { name: "9KT White (Nickel Free - EU)", short: "9KT WG-NF", sg: 11.75, purity: 0.375, metal: "AU" },
  { name: "9KT Yellow Gold", short: "9KT YG", sg: 11.3, purity: 0.375, metal: "AU" },
  { name: "9KT Rose Gold", short: "9KT RG", sg: 11.3, purity: 0.375, metal: "AU" },
  { name: "10KT White (Nickel Safe - USA)", short: "10KT WG", sg: 11.07, purity: 0.417, metal: "AU" },
  { name: "10KT White (Nickel Free - EU)", short: "10KT WG-NF", sg: 12.38, purity: 0.417, metal: "AU" },
  { name: "10KT Yellow Gold", short: "10KT YG", sg: 11.55, purity: 0.417, metal: "AU" },
  { name: "10KT Rose Gold", short: "10KT RG", sg: 11.55, purity: 0.417, metal: "AU" },
  { name: "14KT White (Nickel Safe - USA)", short: "14KT WG", sg: 13.05, purity: 0.583, metal: "AU" },
  { name: "14KT White (Palladium - EU)", short: "14KT WG-PD", sg: 14.25, purity: 0.583, metal: "AU" },
  { name: "14KT Yellow Gold", short: "14KT YG", sg: 13.05, purity: 0.583, metal: "AU" },
  { name: "14KT Rose Gold", short: "14KT RG", sg: 13.05, purity: 0.583, metal: "AU" },
  { name: "18KT White (Nickel Safe - USA)", short: "18KT WG", sg: 14.75, purity: 0.75, metal: "AU" },
  { name: "18KT White (Palladium - EU)", short: "18KT WG-PD", sg: 15.82, purity: 0.75, metal: "AU" },
  { name: "18KT Yellow Gold", short: "18KT YG", sg: 14.75, purity: 0.75, metal: "AU" },
  { name: "18KT Rose Gold", short: "18KT RG", sg: 14.75, purity: 0.75, metal: "AU" },
  { name: "22KT Gold", short: "22KT", sg: 17.8, purity: 0.917, metal: "AU" },
  { name: "24KT Gold (Fine)", short: "24KT", sg: 19.36, purity: 1.0, metal: "AU" },
  { name: "Platinum 600", short: "PT600", sg: 13.05, purity: 0.6, metal: "PT" },
  { name: "Platinum 900", short: "PT900", sg: 20.0, purity: 0.9, metal: "PT" },
  { name: "Platinum 950", short: "PT950", sg: 21.5, purity: 0.952, metal: "PT" },
  { name: "Standard 925 Silver", short: "AG925", sg: 10.3, purity: 0.925, metal: "AG" },
  { name: "Argentium Silver (935)", short: "AG935", sg: 10.4, purity: 0.935, metal: "AG" },
];

const CASTING_PER_GM = 10.0;
const SURCHARGE_PER_GM = 7.0;
const PD_SURCHARGE_PER_GM = 8.38; // illustrative WG-PD kicker, sample value

const LABOR_PER_GM = 22.0;
const LABOR_MIN_FLAT = 55.0;

const CAD_FEES = { None: 0, Simple: 50, Medium: 75, Complex: 100, Advanced: 200 };

// Setting charge tiers: upto ct/pc, rate, rate type
const SETTING_TIERS = [
  { uptoCt: 0.04, rate: 1.0, type: "PER PC" },
  { uptoCt: 0.09, rate: 2.25, type: "PER PC" },
  { uptoCt: 0.14, rate: 3.5, type: "PER PC" },
  { uptoCt: 0.19, rate: 4.75, type: "PER PC" },
  { uptoCt: 0.29, rate: 7.5, type: "PER PC" },
  { uptoCt: 99.0, rate: 25.0, type: "PER CT" },
];

function settingRateFor(wtPerPc, tiers = SETTING_TIERS) {
  for (const tier of tiers) {
    if (wtPerPc <= tier.uptoCt) return tier;
  }
  return tiers[tiers.length - 1];
}

// DiaSize: shape/size catalog (trimmed to representative + commonly used entries)
const DIA_SIZE = [
  { code: "RND0.7M", shape: "Round", size: "0.7 mm (0.002 ct ±)", wt: 0.002, group: "R00" },
  { code: "RND0.8M", shape: "Round", size: "0.8 mm (0.003 ct ±)", wt: 0.003, group: "R00" },
  { code: "RND0.9M", shape: "Round", size: "0.9 mm (0.004 ct ±)", wt: 0.004, group: "R00" },
  { code: "RND1.0M", shape: "Round", size: "1.0 mm (0.005 ct ±)", wt: 0.005, group: "R00" },
  { code: "RND1.1M", shape: "Round", size: "1.1 mm (0.006 ct ±)", wt: 0.006, group: "R00" },
  { code: "RND1.2M", shape: "Round", size: "1.2 mm (0.008 ct ±)", wt: 0.008, group: "R02" },
  { code: "RND1.3M", shape: "Round", size: "1.3 mm (0.01 ct ±)", wt: 0.01, group: "R02" },
  { code: "RND1.4M", shape: "Round", size: "1.4 mm (0.012 ct ±)", wt: 0.012, group: "R02" },
  { code: "RND1.5M", shape: "Round", size: "1.5 mm (0.015 ct ±)", wt: 0.015, group: "R02" },
  { code: "RND1.6M", shape: "Round", size: "1.6 mm (0.017 ct ±)", wt: 0.017, group: "R09" },
  { code: "RND1.7M", shape: "Round", size: "1.7 mm (0.02 ct ±)", wt: 0.02, group: "R09" },
  { code: "RND1.8M", shape: "Round", size: "1.8 mm (0.023 ct ±)", wt: 0.023, group: "R09" },
  { code: "RND1.9M", shape: "Round", size: "1.9 mm (0.027 ct ±)", wt: 0.028, group: "R09" },
  { code: "RND2.0M", shape: "Round", size: "2.0 mm (0.03 ct ±)", wt: 0.032, group: "R11" },
  { code: "RND2.1M", shape: "Round", size: "2.1 mm (0.04 ct ±)", wt: 0.04, group: "R11" },
  { code: "RND2.2M", shape: "Round", size: "2.2 mm (0.045 ct ±)", wt: 0.045, group: "R11" },
  { code: "RND2.3M", shape: "Round", size: "2.3 mm (0.05 ct ±)", wt: 0.05, group: "R12" },
  { code: "RND2.4M", shape: "Round", size: "2.4 mm (0.055 ct ±)", wt: 0.055, group: "R12" },
  { code: "RND2.5M", shape: "Round", size: "2.5 mm (0.06 ct ±)", wt: 0.063, group: "R12" },
  { code: "RND2.6M", shape: "Round", size: "2.6 mm (0.07 ct ±)", wt: 0.073, group: "R14" },
  { code: "RND2.7M", shape: "Round", size: "2.7 mm (0.08ct ±)", wt: 0.08, group: "R14" },
  { code: "RND2.8M", shape: "Round", size: "2.8 mm (0.08-0.09 ct ±)", wt: 0.087, group: "R18" },
  { code: "RND2.9M", shape: "Round", size: "2.9 mm (0.09-0.10 ct ±)", wt: 0.097, group: "R18" },
  { code: "RND3.0M", shape: "Round", size: "3.0 mm (0.10-0.11 ct ±)", wt: 0.107, group: "R20" },
  { code: "RND3.1M", shape: "Round", size: "3.1 mm (0.11-0.12 ct ±)", wt: 0.117, group: "R20" },
  { code: "RND3.2M", shape: "Round", size: "3.2 mm (0.12-0.13 ct ±)", wt: 0.127, group: "R23" },
  { code: "RND3.3M", shape: "Round", size: "3.3 mm (0.14-0.145 ct ±)", wt: 0.143, group: "R23" },
  { code: "RND3.4M", shape: "Round", size: "3.4 mm (0.15-0.16 ct ±)", wt: 0.155, group: "R25" },
  { code: "RND3.5M", shape: "Round", size: "3.5 mm (0.16-0.17 ct ±)", wt: 0.165, group: "R25" },
  { code: "RND3.6M", shape: "Round", size: "3.6 mm (0.17-0.18 ct ±)", wt: 0.175, group: "R25" },
  { code: "RND3.7M", shape: "Round", size: "3.7 mm (0.19-0.21 ct ±)", wt: 0.2, group: "R30" },
  { code: "RND3.8M", shape: "Round", size: "3.8 mm (0.21-0.23 ct ±)", wt: 0.22, group: "R30" },
  { code: "RND3.9M", shape: "Round", size: "3.9 mm (0.23-0.24 ct ±)", wt: 0.235, group: "R30" },
  { code: "RND4.0M", shape: "Round", size: "4.0 mm (0.24-0.26 ct ±)", wt: 0.255, group: "R30" },
  { code: "RND4.1M", shape: "Round", size: "4.1 mm (0.26-0.29 ct ±)", wt: 0.275, group: "R30" },
  { code: "RND030W", shape: "Round", size: "4.2-4.4 mm ± (0.30-0.34 ct)", wt: 0.32, group: "R30" },
  { code: "RND038W", shape: "Round", size: "4.4-4.6 mm ± (0.35-0.39 ct)", wt: 0.365, group: "R38" },
  { code: "RND040W", shape: "Round", size: "4.6-4.8 mm ± (0.40-0.44 ct)", wt: 0.415, group: "R40" },
  { code: "RND046W", shape: "Round", size: "4.7-4.9 mm ± (0.45-0.49 ct)", wt: 0.47, group: "R46" },
  { code: "RND050W", shape: "Round", size: "5.0-5.2 mm ± (0.50-0.59 ct)", wt: 0.51, group: "R50" },
  { code: "RND060W", shape: "Round", size: "5.3-5.5 mm ± (0.60-0.69 ct)", wt: 0.61, group: "R60" },
  { code: "RND070W", shape: "Round", size: "5.5-5.7 mm ± (0.70-0.73 ct)", wt: 0.72, group: "R70" },
  { code: "RND075W", shape: "Round", size: "5.7-5.8 mm ± (0.74-0.79 ct)", wt: 0.76, group: "R75" },
  { code: "RND080W", shape: "Round", size: "5.8-6.0 mm ± (0.80-0.89 ct)", wt: 0.81, group: "R80" },
];

// DiaSSP: $/ct grid by group code and clarity grade. INFERRED row-group
// mapping for the small M-suffix sizes (R00-R25) -- confirm against real
// DiaSize column E and correct if needed.
const DIA_SSP = {
  R00: { "TW VS": 470, "TW SI1": 450, "TW SI2": 410, "TW SI3": 390, "TW I1": 350, "WH SI": 370, "IJ SI2-I1": 340 },
  R02: { "TW VS": 420, "TW SI1": 400, "TW SI2": 370, "TW SI3": 350, "TW I1": 320, "WH SI": 330, "IJ SI2-I1": 300 },
  R09: { "TW VS": 540, "TW SI1": 520, "TW SI2": 470, "TW SI3": 450, "TW I1": 410, "WH SI": 430, "IJ SI2-I1": 365 },
  R11: { "TW VS": 550, "TW SI1": 530, "TW SI2": 480, "TW SI3": 460, "TW I1": 420, "WH SI": 430, "IJ SI2-I1": 390 },
  R12: { "TW VS": 650, "TW SI1": 620, "TW SI2": 560, "TW SI3": 540, "TW I1": 480, "WH SI": 490, "IJ SI2-I1": 435 },
  R14: { "TW VS": 770, "TW SI1": 710, "TW SI2": 650, "TW SI3": 630, "TW I1": 550, "WH SI": 550, "IJ SI2-I1": 495 },
  R18: { "TW VS": 770, "TW SI1": 710, "TW SI2": 650, "TW SI3": 630, "TW I1": 550, "WH SI": 550, "IJ SI2-I1": 495 },
  R20: { "TW VS": 850, "TW SI1": 790, "TW SI2": 730, "TW SI3": 690, "TW I1": 610, "WH SI": 580, "IJ SI2-I1": 535 },
  R23: { "TW VS": 920, "TW SI1": 840, "TW SI2": 790, "TW SI3": 750, "TW I1": 650, "WH SI": 620, "IJ SI2-I1": 575 },
  R25: { "TW VS": 920, "TW SI1": 840, "TW SI2": 790, "TW SI3": 750, "TW I1": 650, "WH SI": 620, "IJ SI2-I1": 575 },
  R30: { "TW VS": 950, "TW SI1": 850, "TW SI2": 810, "TW SI3": 780, "TW I1": 660, "WH SI": 650, "IJ SI2-I1": 615 },
  R38: { "TW VS": 1080, "TW SI1": 930, "TW SI2": 830, "TW SI3": 790, "TW I1": 700, "WH SI": 670, "IJ SI2-I1": 640 },
  R40: { "TW VS": 1120, "TW SI1": 950, "TW SI2": 850, "TW SI3": 800, "TW I1": 720, "WH SI": 680, "IJ SI2-I1": 650 },
  R46: { "TW VS": 1150, "TW SI1": 990, "TW SI2": 900, "TW SI3": 830, "TW I1": 740, "WH SI": 740, "IJ SI2-I1": 705 },
  R50: { "TW VS": 1200, "TW SI1": 1000, "TW SI2": 910, "TW SI3": 850, "TW I1": 770, "WH SI": 760, "IJ SI2-I1": 715 },
  R60: { "TW VS": 1300, "TW SI1": 1050, "TW SI2": 920, "TW SI3": 900, "TW I1": 790, "WH SI": 780, "IJ SI2-I1": 740 },
  R70: { "TW SI2": 1200, "TW SI3": 1100, "TW I1": 950, "WH SI": 900, "IJ SI2-I1": 860 },
  R75: { "TW SI2": 1200, "TW SI3": 1100, "TW I1": 950, "WH SI": 900, "IJ SI2-I1": 860 },
  R80: { "TW SI2": 1300, "TW SI3": 1200, "TW I1": 1050, "WH SI": 1050, "IJ SI2-I1": 1000 },
};

const NATURAL_GRADES = ["TW VS", "TW SI1", "TW SI2", "TW SI3", "TW I1", "WH SI", "IJ SI2-I1"];

// LGD pricing: per-ct, banded by carat weight, non-cert vs cert (graded)
const LGD_NONCERT = [
  { shape: "RND", minCt: 0.0, maxCt: 0.0099, rate: 135 }, // ~ -2 (0.005ct)
  { shape: "RND", minCt: 0.01, maxCt: 0.99, rate: 100 },
];
const LGD_CERT = [
  { shape: "RND & FANCY", minCt: 0.9, maxCt: 1.49, labVS: 170, dvvs2: 160, dvs1: null },
  { shape: "RND & FANCY", minCt: 1.5, maxCt: 1.99, labVS: 200, dvvs2: 170, dvs1: null },
  { shape: "RND & FANCY", minCt: 2.0, maxCt: 3.99, labVS: 220, dvvs2: 180, dvs1: null },
  { shape: "RND & FANCY", minCt: 4.0, maxCt: 4.99, labVS: 280, dvvs2: 250, dvs1: null },
  { shape: "FANCY", minCt: 0.01, maxCt: 0.49, labVS: 280, dvvs2: 250, dvs1: 200 },
  { shape: "FANCY", minCt: 0.5, maxCt: 0.89, labVS: 280, dvvs2: 250, dvs1: 150 },
  { shape: "RND", minCt: 0.5, maxCt: 0.89, labVS: 230, dvvs2: 200, dvs1: 100 },
  { shape: "ODD", minCt: 0.01, maxCt: 3.99, labVS: 250, dvvs2: null, dvs1: null },
];
const LGD_GRADES = ["Non-cert", "Lab VS", "D/VVS2", "D/VS1"];

const QUALITY_OPTIONS = [...NATURAL_GRADES, "LGD"];

/* ============================================================
   LIVE DATA: see sheetData.js for the multi-tab fetch/parse layer
   and config.js for where to paste your published-sheet URLs.
   ============================================================ */

/* ============================================================
   HELPERS
   ============================================================ */

const fmt = (n, dp = 2) =>
  isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "0.00";

const fmtCurrency = (n, dp = 2) => "$" + fmt(n, dp);

function emptyRow() {
  return { mode: "natural", sizeCode: "", quality: "TW SI1", lgdGrade: "Non-cert", lgdShape: "RND", pcs: "", customShape: "", customWt: "", customRate: "" };
}

// SSP price cipher (JADELIGHTX): letters encode digits so overseas offices
// can read the price on a customer-facing quote. E.g. 4625 -> "EIAL".
const SSP_MAP = { 1: "J", 2: "A", 3: "D", 4: "E", 5: "L", 6: "I", 7: "G", 8: "H", 9: "T", 0: "X" };
function sspEncode(n) {
  if (!isFinite(n)) return "";
  return String(Math.round(Math.abs(n)))
    .split("")
    .map((d) => SSP_MAP[Number(d)] || "?")
    .join("");
}
const CUSTOM_CODE = "__CUSTOM__";

function netRatePerGm(alloy, metalRates) {
  const rates = metalRates[alloy.metal];
  if (!rates) return 0;
  // PM rate path: convert oz->gm, apply purity, then add casting+surcharge per gm
  const ozRate = rates.pmRateOz;
  const baseRate = (ozRate / 31.1035) * alloy.purity;
  const pdKicker = alloy.short.includes("WG-PD") ? PD_SURCHARGE_PER_GM : 0;
  return baseRate + pdKicker;
}

function castingCost(gramWt, alloy, metalRates) {
  if (!alloy) return 0;
  const base = netRatePerGm(alloy, metalRates);
  return gramWt * (base + CASTING_PER_GM + SURCHARGE_PER_GM);
}

/* ============================================================
   PDF order form parsing lives in pdfParser.js. It reads the
   embedded %%CAD_FORM_DATA%% JSON block your CAD system writes
   into each card and maps it onto calculator state.
   ============================================================ */

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function JwyCalculator() {
  const [jobInfo, setJobInfo] = useState({
    designer: "Kunal",
    jobNo: "S01022",
    customer: "",
    cadType: "Medium",
  });
  const [location, setLocation] = useState("WSSY");
  const [primaryAlloyShort, setPrimaryAlloyShort] = useState("14KT YG");
  const [primaryGramWt, setPrimaryGramWt] = useState(3.6);
  const [secondaryAlloyShort, setSecondaryAlloyShort] = useState("14KT WG-PD");
  const [secondaryGramWt, setSecondaryGramWt] = useState(0.5);
  const [rows, setRows] = useState(Array.from({ length: 12 }, emptyRow));
  const [savedQuotes, setSavedQuotes] = useState(() => {
    try {
      return JSON.parse(__memStore.getItem("jwyQuotes") || "[]");
    } catch {
      return [];
    }
  });
  const [pdfStatus, setPdfStatus] = useState(""); // "", "loading", "unmapped", "error", "done"
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfImport, setPdfImport] = useState(null);

  // Live data: each table falls back independently to its bundled sample
  // if its sheet URL isn't configured or its fetch fails, so a typo in
  // one tab's URL never breaks the whole calculator.
  const [liveData, setLiveData] = useState({
    metalRates: SAMPLE_METAL_RATES,
    alloys: ALLOYS,
    currencyRates: SAMPLE_CURRENCY_RATES,
    currencyMarkup: 1.05,
    locations: LOCATIONS,
    laborPerGm: LABOR_PER_GM,
    laborMinFlat: LABOR_MIN_FLAT,
    cadFees: CAD_FEES,
    settingTiers: SETTING_TIERS,
  });
  const [tableSources, setTableSources] = useState({
    metalRates: "sample",
    alloys: "sample",
    currencyRates: "sample",
    locations: "sample",
    cadFeesAndLabor: "sample",
    settingTiers: "sample",
  });
  const [rateLoading, setRateLoading] = useState(false);
  const [rateErrors, setRateErrors] = useState({});
  const [lastSync, setLastSync] = useState(null);

  const refreshRates = useCallback(async () => {
    setRateLoading(true);
    try {
      const { data, errors } = await fetchLiveSheetData();
      setLiveData((prev) => ({
        metalRates: data.metalRates && Object.keys(data.metalRates).length ? data.metalRates : prev.metalRates,
        alloys: data.alloys && data.alloys.length ? data.alloys : prev.alloys,
        currencyRates:
          data.currencyRates && Object.keys(data.currencyRates.rates || {}).length
            ? data.currencyRates.rates
            : prev.currencyRates,
        currencyMarkup: data.currencyRates ? data.currencyRates.markup : prev.currencyMarkup,
        locations: data.locations && data.locations.length ? data.locations : prev.locations,
        laborPerGm: data.cadFeesAndLabor ? data.cadFeesAndLabor.laborPerGm : prev.laborPerGm,
        laborMinFlat: data.cadFeesAndLabor ? data.cadFeesAndLabor.laborMinFlat : prev.laborMinFlat,
        cadFees: data.cadFeesAndLabor ? data.cadFeesAndLabor.cadFees : prev.cadFees,
        settingTiers: data.settingTiers && data.settingTiers.length ? data.settingTiers : prev.settingTiers,
      }));
      setTableSources({
        metalRates: data.metalRates ? "live" : "sample",
        alloys: data.alloys ? "live" : "sample",
        currencyRates: data.currencyRates ? "live" : "sample",
        locations: data.locations ? "live" : "sample",
        cadFeesAndLabor: data.cadFeesAndLabor ? "live" : "sample",
        settingTiers: data.settingTiers ? "live" : "sample",
      });
      setRateErrors(errors);
      setLastSync(new Date());
    } catch (e) {
      setRateErrors({ all: e.message || String(e) });
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRates();
    const id = setInterval(refreshRates, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshRates]);

  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfStatus("loading");
    setPdfImport(null);
    try {
      const result = await parseOrderFormPdf(file, {
        alloys: liveData.alloys,
        diaSize: DIA_SIZE,
      });
      if (!result.ok) {
        setPdfStatus(result.reason === "no-embedded-data" ? "unmapped" : "error");
        setPdfImport(result.diag ? { error: result.diag } : null);
        return;
      }
      const { jobInfo: ji, metals, metalWarnings, stones } = result.data;

      // Apply job info.
      setJobInfo((prev) => ({
        ...prev,
        designer: ji.designer || prev.designer,
        jobNo: ji.jobNo || prev.jobNo,
        customer: ji.styleCode || prev.customer, // style code is the closest stable id
      }));

      // Apply metals (already weight-sorted: primary = heavier).
      if (metals.primary) {
        if (liveData.alloys.some((a) => a.short === metals.primary.short)) {
          setPrimaryAlloyShort(metals.primary.short);
        }
        setPrimaryGramWt(metals.primary.wt);
      }
      if (metals.secondary) {
        if (liveData.alloys.some((a) => a.short === metals.secondary.short)) {
          setSecondaryAlloyShort(metals.secondary.short);
        }
        setSecondaryGramWt(metals.secondary.wt);
      }

      // Apply stones -> calculator rows. Each row carries its own pricing
      // mode, so cards mixing mined and lab-grown stones import fully.
      const newRows = Array.from({ length: 12 }, emptyRow);
      stones.slice(0, 12).forEach((s, i) => {
        newRows[i] = {
          mode: s.diamondMode || "natural",
          sizeCode: s.isCustom ? CUSTOM_CODE : s.sizeCode || "",
          quality: "TW SI1",
          lgdGrade: "Non-cert",
          lgdShape: s.lgdShape || "RND",
          pcs: s.qty ? String(s.qty) : "",
          customShape: s.customShape || "",
          customWt: s.customWt ? String(s.customWt) : "",
          customRate: "",
        };
      });
      setRows(newRows);

      setPdfImport({
        fileName: file.name,
        metalWarnings,
        metals,
        stones,
      });
      setPdfStatus("done");
    } catch (err) {
      setPdfStatus("error");
      setPdfImport({ error: (err && err.message) || String(err) });
    }
  };

  const clearAll = () => {
    setJobInfo({ designer: "", jobNo: "", customer: "", cadType: "Medium" });
    setPrimaryGramWt(0);
    setSecondaryGramWt(0);
    setRows(Array.from({ length: 12 }, emptyRow));
    setPdfImport(null);
    setPdfStatus("");
    setPdfFileName("");
  };

  const persistQuotes = (list) => {
    setSavedQuotes(list);
    try {
      __memStore.setItem("jwyQuotes", JSON.stringify(list));
    } catch {}
  };

  const saveQuote = () => {
    const snapshot = {
      id: Date.now(),
      label: `${jobInfo.jobNo || "no-job"} · ${new Date().toLocaleString()}`,
      jobInfo,
      location,
      primaryAlloyShort,
      primaryGramWt,
      secondaryAlloyShort,
      secondaryGramWt,
      rows,
    };
    persistQuotes([snapshot, ...savedQuotes].slice(0, 50));
  };

  const loadQuote = (id) => {
    const q = savedQuotes.find((s) => s.id === id);
    if (!q) return;
    setJobInfo(q.jobInfo);
    setLocation(q.location);
    setPrimaryAlloyShort(q.primaryAlloyShort);
    setPrimaryGramWt(q.primaryGramWt);
    setSecondaryAlloyShort(q.secondaryAlloyShort);
    setSecondaryGramWt(q.secondaryGramWt);
    setRows(q.rows.map((r) => ({ ...emptyRow(), ...r })));
  };

  const deleteQuote = (id) => {
    persistQuotes(savedQuotes.filter((s) => s.id !== id));
  };

  const metalRates = liveData.metalRates;
  const alloyList = liveData.alloys;
  const currencyRates = liveData.currencyRates;
  const locationList = liveData.locations;
  const settingTiersLive = liveData.settingTiers;

  const primaryAlloy = alloyList.find((a) => a.short === primaryAlloyShort) || alloyList[0];
  const secondaryAlloy = alloyList.find((a) => a.short === secondaryAlloyShort) || alloyList[0];
  const totalGramWt = (parseFloat(primaryGramWt) || 0) + (parseFloat(secondaryGramWt) || 0);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const rowCalcs = useMemo(() => {
    return rows.map((row) => {
      const pcs = parseFloat(row.pcs) || 0;
      if (row.sizeCode === CUSTOM_CODE) {
        const wtPerPc = parseFloat(row.customWt) || 0;
        const perCt = parseFloat(row.customRate) || 0;
        const totalWt = wtPerPc * pcs;
        const tier = settingRateFor(wtPerPc, settingTiersLive);
        const settingTotal = pcs > 0 ? (tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs) : 0;
        return {
          shape: row.customShape || "Custom",
          size: "manual entry",
          wtPerPc,
          totalWt,
          perCt,
          total: totalWt * perCt,
          settingTotal,
          settingType: tier.type,
        };
      }
      const sizeEntry = DIA_SIZE.find((d) => d.code === row.sizeCode);
      if (!sizeEntry || pcs <= 0) {
        return { shape: "", size: "", wtPerPc: 0, totalWt: 0, perCt: 0, total: 0, settingTotal: 0, settingType: "PER PC" };
      }
      const totalWt = sizeEntry.wt * pcs;

      let perCt = 0;
      if ((row.mode || "natural") === "natural") {
        const grid = DIA_SSP[sizeEntry.group];
        perCt = grid?.[row.quality] || 0;
      } else {
        const wtPerPc = sizeEntry.wt;
        if (wtPerPc < 0.01 || row.lgdGrade === "Non-cert") {
          const band = LGD_NONCERT.find((b) => wtPerPc >= b.minCt && wtPerPc <= b.maxCt);
          perCt = band?.rate || 0;
        } else {
          const band = LGD_CERT.find(
            (b) => (b.shape === row.lgdShape || b.shape === "RND & FANCY") && wtPerPc >= b.minCt && wtPerPc <= b.maxCt
          );
          if (band) {
            if (row.lgdGrade === "Lab VS") perCt = band.labVS || 0;
            else if (row.lgdGrade === "D/VVS2") perCt = band.dvvs2 || 0;
            else if (row.lgdGrade === "D/VS1") perCt = band.dvs1 || 0;
          }
        }
      }

      const total = totalWt * perCt;
      const tier = settingRateFor(sizeEntry.wt, settingTiersLive);
      const settingTotal = tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs;

      return {
        shape: sizeEntry.shape,
        size: sizeEntry.size,
        wtPerPc: sizeEntry.wt,
        totalWt,
        perCt,
        total,
        settingTotal,
        settingType: tier.type,
      };
    });
  }, [rows, settingTiersLive]);

  const totals = useMemo(() => {
    const totalWt = rowCalcs.reduce((s, r) => s + r.totalWt, 0);
    const totalPcs = rows.reduce((s, r) => s + (parseFloat(r.pcs) || 0), 0);
    const diamondTotal = rowCalcs.reduce((s, r) => s + r.total, 0);
    const settingTotal = rowCalcs.reduce((s, r) => s + r.settingTotal, 0);
    return { totalWt, totalPcs, diamondTotal, settingTotal };
  }, [rowCalcs, rows]);

  const casting = useMemo(() => {
    const primaryCost = castingCost(parseFloat(primaryGramWt) || 0, primaryAlloy, metalRates);
    const secondaryCost = castingCost(parseFloat(secondaryGramWt) || 0, secondaryAlloy, metalRates);
    return primaryCost + secondaryCost;
  }, [primaryAlloy, secondaryAlloy, primaryGramWt, secondaryGramWt, metalRates]);

  const labor = useMemo(() => {
    const perGm = totalGramWt * liveData.laborPerGm;
    return Math.max(perGm, liveData.laborMinFlat);
  }, [totalGramWt, liveData.laborPerGm, liveData.laborMinFlat]);

  const cadFee = liveData.cadFees[jobInfo.cadType] ?? 0;
  const grossTotalUSD = casting + labor + cadFee + totals.diamondTotal + totals.settingTotal;
  const locInfo = locationList.find((l) => l.code === location) || locationList[0];
  const fxRate = (currencyRates[locInfo.currency] || 1) * liveData.currencyMarkup;
  const totalWithDutyUSD = grossTotalUSD * (1 + locInfo.duty);
  const totalWithDutyLocal = totalWithDutyUSD * fxRate;
  const sspCode = sspEncode(totalWithDutyUSD);
  const breakupPct = (val) => (grossTotalUSD > 0 ? (val / grossTotalUSD) * 100 : 0);

  const [printVariant, setPrintVariant] = useState(null);
  const doPrint = (variant) => {
    setPrintVariant(variant);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintVariant(null), 400);
    }, 80);
  };

  return (
    <div style={styles.app}>
      <GlobalStyles />
      <div className="print-only">
        <PrintQuote
          variant={printVariant || "full"}
          jobInfo={jobInfo}
          locInfo={locInfo}
          primaryAlloy={primaryAlloy}
          primaryGramWt={primaryGramWt}
          secondaryAlloy={secondaryAlloy}
          secondaryGramWt={secondaryGramWt}
          rows={rows}
          rowCalcs={rowCalcs}
          totals={totals}
          casting={casting}
          labor={labor}
          cadFee={cadFee}
          grossTotalUSD={grossTotalUSD}
          totalWithDutyUSD={totalWithDutyUSD}
          totalWithDutyLocal={totalWithDutyLocal}
          fxRate={fxRate}
          sspCode={sspCode}
        />
      </div>
      <div className="screen-only">
      <TopBar
        jobInfo={jobInfo}
        pdfFileName={pdfFileName}
        pdfStatus={pdfStatus}
        pdfImport={pdfImport}
        onPdfUpload={handlePdfUpload}
        onClear={clearAll}
      />

      <div style={styles.shell}>
        <JobInfoCard
          jobInfo={jobInfo}
          setJobInfo={setJobInfo}
          location={location}
          setLocation={setLocation}
          locationList={locationList}
          cadFees={liveData.cadFees}
        />

        {pdfImport && <PdfImportReview pdfImport={pdfImport} />}

        <RatesStatusCard
          tableSources={tableSources}
          rateLoading={rateLoading}
          rateErrors={rateErrors}
          refreshRates={refreshRates}
          metalRates={metalRates}
          totalGramWt={totalGramWt}
          lastSync={lastSync}
        />

        <div style={styles.grid2}>
          <MetalPanel
            title="Primary metal"
            alloyShort={primaryAlloyShort}
            setAlloyShort={setPrimaryAlloyShort}
            alloyList={alloyList}
            gramWt={primaryGramWt}
            setGramWt={setPrimaryGramWt}
          />
          <MetalPanel
            title="Secondary metal"
            alloyShort={secondaryAlloyShort}
            setAlloyShort={setSecondaryAlloyShort}
            alloyList={alloyList}
            gramWt={secondaryGramWt}
            setGramWt={setSecondaryGramWt}
          />
        </div>

        <QuotesToolbar
          savedQuotes={savedQuotes}
          onSave={saveQuote}
          onLoad={loadQuote}
          onDelete={deleteQuote}
          onPrint={doPrint}
        />

        <StoneGrid rows={rows} updateRow={updateRow} rowCalcs={rowCalcs} totals={totals} />

        <BreakupSummary
          casting={casting}
          labor={labor}
          cadFee={cadFee}
          cadType={jobInfo.cadType}
          diamondTotal={totals.diamondTotal}
          settingTotal={totals.settingTotal}
          grossTotalUSD={grossTotalUSD}
          locInfo={locInfo}
          fxRate={fxRate}
          totalWithDutyUSD={totalWithDutyUSD}
          totalWithDutyLocal={totalWithDutyLocal}
          breakupPct={breakupPct}
          sspCode={sspCode}
        />
      </div>
      </div>
    </div>
  );
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */


function PrintQuote({
  variant, jobInfo, locInfo, primaryAlloy, primaryGramWt, secondaryAlloy, secondaryGramWt,
  rows, rowCalcs, totals, casting, labor, cadFee, grossTotalUSD, totalWithDutyUSD,
  totalWithDutyLocal, fxRate, sspCode,
}) {
  const showPrices = variant === "full";
  const activeRows = rows
    .map((r, i) => ({ r, c: rowCalcs[i], i }))
    .filter(({ r, c }) => (r.sizeCode || r.customShape) && c.totalWt > 0);
  const cell = { padding: "5px 8px", borderBottom: "1px solid #ddd", fontSize: 12 };
  const cellR = { ...cell, textAlign: "right" };
  const hd = { ...cell, fontWeight: 700, borderBottom: "2px solid #333", fontSize: 11, textTransform: "uppercase" };
  return (
    <div style={{ fontFamily: "Georgia, serif", color: "#111", padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "3px solid #9C4A63", paddingBottom: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>JWY Quotation</div>
          <div style={{ fontSize: 12, color: "#555" }}>Job {jobInfo.jobNo || "—"} · Designer {jobInfo.designer || "—"} · {new Date().toLocaleDateString()}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "#555" }}>
          <div>{jobInfo.customer || ""}</div>
          <div>Location: {locInfo.code} ({locInfo.currency})</div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        <b>Metals:</b> {primaryAlloy ? `${primaryAlloy.short} ${fmt(parseFloat(primaryGramWt) || 0, 2)}g` : "—"}
        {secondaryAlloy && (parseFloat(secondaryGramWt) || 0) > 0 ? ` + ${secondaryAlloy.short} ${fmt(parseFloat(secondaryGramWt) || 0, 2)}g` : ""}
        {" · "}CAD: {jobInfo.cadType}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <thead>
          <tr>
            <th style={hd}>Pos</th><th style={hd}>Type</th><th style={hd}>Shape / size</th>
            <th style={{ ...hd, textAlign: "right" }}>Qty</th><th style={{ ...hd, textAlign: "right" }}>Total ct</th>
            {showPrices && <th style={{ ...hd, textAlign: "right" }}>$/ct</th>}
            {showPrices && <th style={{ ...hd, textAlign: "right" }}>$ total</th>}
          </tr>
        </thead>
        <tbody>
          {activeRows.map(({ r, c, i }) => (
            <tr key={i}>
              <td style={cell}>{i + 1}</td>
              <td style={cell}>{(r.mode || "natural") === "lgd" ? "Lab grown" : "Mined"}</td>
              <td style={cell}>{c.shape} · {c.size}</td>
              <td style={cellR}>{r.pcs}</td>
              <td style={cellR}>{fmt(c.totalWt, 3)}</td>
              {showPrices && <td style={cellR}>{fmtCurrency(c.perCt)}</td>}
              {showPrices && <td style={cellR}>{fmtCurrency(c.total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {showPrices ? (
        <div style={{ fontSize: 13 }}>
          <table style={{ marginLeft: "auto", borderCollapse: "collapse" }}>
            <tbody>
              <tr><td style={cell}>Casting</td><td style={cellR}>{fmtCurrency(casting)}</td></tr>
              <tr><td style={cell}>Labor</td><td style={cellR}>{fmtCurrency(labor)}</td></tr>
              <tr><td style={cell}>CAD ({jobInfo.cadType})</td><td style={cellR}>{fmtCurrency(cadFee)}</td></tr>
              <tr><td style={cell}>Diamonds</td><td style={cellR}>{fmtCurrency(totals.diamondTotal)}</td></tr>
              <tr><td style={cell}>Setting</td><td style={cellR}>{fmtCurrency(totals.settingTotal)}</td></tr>
              <tr><td style={{ ...cell, fontWeight: 700 }}>Gross total (USD)</td><td style={{ ...cellR, fontWeight: 700 }}>{fmtCurrency(grossTotalUSD)}</td></tr>
              <tr><td style={cell}>With {(locInfo.duty * 100).toFixed(0)}% duty (USD)</td><td style={cellR}>{fmtCurrency(totalWithDutyUSD)}</td></tr>
              <tr><td style={{ ...cell, fontWeight: 700 }}>{locInfo.code} total ({locInfo.currency}, fx {fmt(fxRate, 3)})</td><td style={{ ...cellR, fontWeight: 700 }}>{fmtCurrency(totalWithDutyLocal)}</td></tr>
              <tr><td style={cell}>SSP</td><td style={{ ...cellR, letterSpacing: 2 }}>{sspCode}</td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#555" }}>Reference code</div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>{sspCode}</div>
        </div>
      )}
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      input, select { font-family: inherit; }
      input:focus, select:focus { outline: 2px solid #9C4A63; outline-offset: -1px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; }
      ::-webkit-scrollbar { height: 8px; width: 8px; }
      ::-webkit-scrollbar-thumb { background: #E3C3CD; border-radius: 4px; }
      .print-only { display: none; }
      @media print {
        .screen-only { display: none !important; }
        .print-only { display: block !important; }
      }
    `}</style>
  );
}

function TopBar({ jobInfo, pdfFileName, pdfStatus, pdfImport, onPdfUpload, onClear }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.topBarInner}>
        <div style={styles.brandBlock}>
          <div style={styles.brandMark}>JWY</div>
          <div>
            <div style={styles.brandTitle}>Jewelry quoting console</div>
            <div style={styles.brandSub}>Job {jobInfo.jobNo || "—"}</div>
          </div>
        </div>
        <div style={styles.topBarActions}>
          <button style={styles.uploadBtn} onClick={onClear} type="button">
            Clear form
          </button>
          <label style={styles.uploadBtn}>
            <i className="ti ti-file-upload" aria-hidden="true" style={{ fontSize: 15, marginRight: 6 }} />
            Load CAD order form
            <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={onPdfUpload} />
          </label>
        </div>
      </div>
      {pdfFileName && (
        <div style={styles.pdfStatusBar}>
          {pdfStatus === "loading" && <>Reading {pdfFileName}…</>}
          {pdfStatus === "done" && <>Imported {pdfFileName} — job, metals, and stones populated below. Review flagged rows.</>}
          {pdfStatus === "unmapped" && (
            <>
              Loaded {pdfFileName}, but couldn't use its embedded CAD data.
              {pdfImport && pdfImport.error ? ` Detail: ${pdfImport.error}` : ""}
            </>
          )}
          {pdfStatus === "error" && (
            <>Couldn't read {pdfFileName}. {pdfImport && pdfImport.error ? `Error: ${pdfImport.error}` : "Try re-exporting the card from your CAD system."}</>
          )}
        </div>
      )}
    </div>
  );
}

function PdfImportReview({ pdfImport }) {
  if (pdfImport.error) {
    return (
      <div style={styles.card}>
        <SectionLabel eyebrow="!" title="CAD import error" />
        <div style={styles.warnBanner}>{pdfImport.error}</div>
      </div>
    );
  }
  const { metals, metalWarnings, stones } = pdfImport;
  const flagged = stones.filter((s) => s.flag);
  return (
    <div style={{ ...styles.card, borderColor: "#C9A35C", borderWidth: 1 }}>
      <SectionLabel eyebrow="↓" title="Imported from CAD card — review" />
      <div style={styles.importMetaRow}>
        {metals.primary && (
          <span style={styles.importChip}>
            Primary: {metals.primary.short} · {fmt(metals.primary.wt, 2)}g
          </span>
        )}
        {metals.secondary && (
          <span style={styles.importChip}>
            Secondary: {metals.secondary.short} · {fmt(metals.secondary.wt, 2)}g
          </span>
        )}
        <span style={styles.importChip}>{stones.length} stone row(s)</span>
      </div>

      {(metalWarnings.length > 0 || flagged.length > 0) && (
        <div style={styles.warnBanner}>
          {metalWarnings.map((w, i) => (
            <div key={"mw" + i}>• {w}</div>
          ))}
          {flagged.map((s, i) => (
            <div key={"sf" + i}>
              • {s.pos} {s.shape} ({s.stoneType}): {s.flag}
            </div>
          ))}
        </div>
      )}

      <table style={styles.table}>
        <thead>
          <tr style={styles.theadRow}>
            <th style={styles.th}>Pos</th>
            <th style={styles.th}>Stone</th>
            <th style={styles.th}>Shape</th>
            <th style={styles.th}>Dims</th>
            <th style={styles.th}>Col</th>
            <th style={styles.th}>Clar</th>
            <th style={styles.thRight}>Avg ct</th>
            <th style={styles.thRight}>Qty</th>
            <th style={styles.thRight}>Total ct</th>
            <th style={styles.th}>Mapped to</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {stones.map((s, i) => (
            <tr key={i} style={styles.tr}>
              <td style={styles.td}>{s.pos}</td>
              <td style={styles.td}>{s.stoneType}</td>
              <td style={styles.td}>{s.shape}</td>
              <td style={{ ...styles.td, color: "var(--muted)", fontSize: 12 }}>{s.dims}</td>
              <td style={styles.td}>{s.col || "—"}</td>
              <td style={styles.td}>{s.clar || "—"}</td>
              <td style={styles.tdRight}>{fmt(s.avgWt, 4)}</td>
              <td style={styles.tdRight}>{s.qty}</td>
              <td style={styles.tdRight}>{fmt(s.totalWt, 3)}</td>
              <td style={styles.td}>{s.sizeCode || "—"}</td>
              <td style={styles.td}>
                {s.flag ? (
                  <span style={styles.flagPill}>flag</span>
                ) : (
                  <span style={styles.okPill}>priced</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobInfoCard({ jobInfo, setJobInfo, location, setLocation, locationList, cadFees }) {
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="01" title="Job details" />
      <div style={styles.fieldRow}>
        <Field label="Designer">
          <input
            style={styles.input}
            value={jobInfo.designer}
            onChange={(e) => setJobInfo({ ...jobInfo, designer: e.target.value })}
          />
        </Field>
        <Field label="Job #">
          <input
            style={styles.input}
            value={jobInfo.jobNo}
            onChange={(e) => setJobInfo({ ...jobInfo, jobNo: e.target.value })}
          />
        </Field>
        <Field label="Customer" grow>
          <input
            style={styles.input}
            placeholder="Customer name"
            value={jobInfo.customer}
            onChange={(e) => setJobInfo({ ...jobInfo, customer: e.target.value })}
          />
        </Field>
        <Field label="CAD type">
          <select
            style={styles.input}
            value={jobInfo.cadType}
            onChange={(e) => setJobInfo({ ...jobInfo, cadType: e.target.value })}
          >
            {Object.keys(cadFees).map((k) => (
              <option key={k} value={k}>
                {k} (${cadFees[k]})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <select style={styles.input} value={location} onChange={(e) => setLocation(e.target.value)}>
            {locationList.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} · {l.currency} · {(l.duty * 100).toFixed(0)}% duty
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function RatesStatusCard({ tableSources, rateLoading, rateErrors, refreshRates, metalRates, totalGramWt, lastSync }) {
  const allLive = Object.values(tableSources).every((s) => s === "live");
  const anyLive = Object.values(tableSources).some((s) => s === "live");
  const errorList = Object.entries(rateErrors || {}).filter(([, v]) => v);
  return (
    <div style={styles.card}>
      <div style={styles.rowBetween}>
        <SectionLabel eyebrow="02" title="Live data sync" />
        <div style={styles.rateStatus}>
          <span style={{ ...styles.dot, background: allLive ? "#3F8F5F" : anyLive ? "#B5651D" : "#9B8088" }} />
          {rateLoading
            ? "Syncing…"
            : allLive
            ? "All sheets connected"
            : anyLive
            ? "Partially connected"
            : "Using bundled sample data"}
          <button style={styles.smallBtn} onClick={refreshRates} disabled={rateLoading}>
            Sync now
          </button>
        </div>
      </div>
      <div style={styles.tableSourceRow}>
        {Object.entries(tableSources).map(([k, v]) => (
          <span key={k} style={{ ...styles.sourcePill, ...(v === "live" ? styles.sourcePillLive : {}) }}>
            {k}
          </span>
        ))}
      </div>
      {lastSync && <div style={styles.syncNote}>Last synced {lastSync.toLocaleTimeString()}</div>}
      {errorList.length > 0 && (
        <div style={styles.warnBanner}>
          {errorList.map(([k, v]) => (
            <div key={k}>
              {k}: {v === "not configured" ? "no sheet URL set in config.js, using bundled sample data" : v}
            </div>
          ))}
        </div>
      )}
      <table style={styles.table}>
        <thead>
          <tr style={styles.theadRow}>
            <th style={styles.th}>Metal</th>
            <th style={styles.th}>As on</th>
            <th style={styles.thRight}>PM rate/oz</th>
            <th style={styles.thRight}>Spot rate/oz</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(metalRates).map(([code, r]) => (
            <tr key={code} style={styles.tr}>
              <td style={styles.td}>{r.label || code}</td>
              <td style={{ ...styles.td, color: "var(--muted)" }}>{r.asOf}</td>
              <td style={styles.tdRight}>{fmtCurrency(r.pmRateOz)}</td>
              <td style={styles.tdRight}>{fmtCurrency(r.spotOz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={styles.totalGramNote}>Total gram weight: {fmt(totalGramWt, 3)} g</div>
    </div>
  );
}

function MetalPanel({ title, alloyShort, setAlloyShort, alloyList, gramWt, setGramWt }) {
  return (
    <div style={styles.card}>
      <div style={styles.panelTitle}>{title}</div>
      <div style={styles.fieldRow}>
        <Field label="Alloy" grow>
          <select style={styles.input} value={alloyShort} onChange={(e) => setAlloyShort(e.target.value)}>
            {alloyList.map((a) => (
              <option key={a.short} value={a.short}>
                {a.short} — {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gram wt">
          <input
            style={{ ...styles.input, width: 90 }}
            type="number"
            step="0.001"
            value={gramWt}
            onChange={(e) => setGramWt(e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function QuotesToolbar({ savedQuotes, onSave, onLoad, onDelete, onPrint }) {
  const [selected, setSelected] = useState("");
  return (
    <div style={{ ...styles.card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <SectionLabel eyebrow="03" title="Quotes" noMargin />
      <button style={styles.toggleBtn} onClick={onSave} type="button">
        Save current quote
      </button>
      <select
        style={{ ...styles.input, minWidth: 220 }}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Saved quotes…</option>
        {savedQuotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button
        style={styles.toggleBtn}
        type="button"
        disabled={!selected}
        onClick={() => selected && onLoad(Number(selected))}
      >
        Load
      </button>
      <button
        style={styles.toggleBtn}
        type="button"
        disabled={!selected}
        onClick={() => {
          if (selected) {
            onDelete(Number(selected));
            setSelected("");
          }
        }}
      >
        Delete
      </button>
      <button style={{ ...styles.toggleBtn, ...styles.toggleBtnActive }} onClick={() => onPrint("full")} type="button">
        Print (full prices)
      </button>
      <button style={{ ...styles.toggleBtn, ...styles.toggleBtnActive }} onClick={() => onPrint("ssp")} type="button">
        Print with SSP only
      </button>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>
        Saved on this device (browser storage) — clearing browser data removes them.
      </span>
    </div>
  );
}

function StoneGrid({ rows, updateRow, rowCalcs, totals }) {
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="04" title="Stone schedule" />
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.theadRow}>
              <th style={styles.th}>Pos</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Size</th>
              <th style={styles.th}>Shape</th>
              <th style={styles.th}>Spec</th>
              <th style={styles.th}>Quality</th>
              <th style={styles.thRight}>Wt/pc</th>
              <th style={styles.thRight}>Pcs</th>
              <th style={styles.thRight}>Total wt</th>
              <th style={styles.thRight}>$/ct</th>
              <th style={styles.thRight}>$ total</th>
              <th style={styles.thRight}>$ setting</th>
              <th style={styles.th}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const calc = rowCalcs[i];
              const active = !!row.sizeCode && (parseFloat(row.pcs) || 0) > 0;
              return (
                <tr key={i} style={{ ...styles.tr, ...(active ? styles.trActive : {}) }}>
                  <td style={styles.td}>
                    <span style={{ ...styles.posBadge, ...(active ? styles.posBadgeActive : {}) }}>{i + 1}</span>
                  </td>
                  <td style={styles.td}>
                    <select
                      style={{ ...styles.inputSm, width: 74 }}
                      value={row.mode || "natural"}
                      onChange={(e) => updateRow(i, { mode: e.target.value })}
                    >
                      <option value="natural">Mined</option>
                      <option value="lgd">LGD</option>
                    </select>
                  </td>
                  <td style={styles.td}>
                    <select
                      style={styles.inputSm}
                      value={row.sizeCode}
                      onChange={(e) => updateRow(i, { sizeCode: e.target.value })}
                    >
                      <option value="">Select size</option>
                      <option value={CUSTOM_CODE}>Custom entry…</option>
                      {DIA_SIZE.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    {row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 80 }}
                        placeholder="Shape"
                        value={row.customShape}
                        onChange={(e) => updateRow(i, { customShape: e.target.value })}
                      />
                    ) : (
                      calc.shape
                    )}
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: "var(--muted)" }}>{calc.size}</td>
                  <td style={styles.td}>
                    {(row.mode || "natural") === "natural" ? (
                      <select
                        style={styles.inputSm}
                        value={row.quality}
                        onChange={(e) => updateRow(i, { quality: e.target.value })}
                      >
                        {NATURAL_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        <select
                          style={{ ...styles.inputSm, width: 64 }}
                          value={row.lgdShape}
                          onChange={(e) => updateRow(i, { lgdShape: e.target.value })}
                        >
                          <option value="RND">RND</option>
                          <option value="FANCY">FANCY</option>
                          <option value="ODD">ODD</option>
                        </select>
                        <select
                          style={styles.inputSm}
                          value={row.lgdGrade}
                          onChange={(e) => updateRow(i, { lgdGrade: e.target.value })}
                        >
                          {LGD_GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </td>
                  <td style={styles.tdRight}>
                    {row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 62, textAlign: "right" }}
                        type="number"
                        step="0.001"
                        placeholder="ct/pc"
                        value={row.customWt}
                        onChange={(e) => updateRow(i, { customWt: e.target.value })}
                      />
                    ) : calc.wtPerPc ? (
                      fmt(calc.wtPerPc, 3)
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.inputSm, width: 48, textAlign: "right" }}
                      type="number"
                      min="0"
                      value={row.pcs}
                      onChange={(e) => updateRow(i, { pcs: e.target.value })}
                    />
                  </td>
                  <td style={styles.tdRight}>{fmt(calc.totalWt, 3)}</td>
                  <td style={styles.tdRight}>
                    {row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 66, textAlign: "right" }}
                        type="number"
                        step="1"
                        placeholder="$/ct"
                        value={row.customRate}
                        onChange={(e) => updateRow(i, { customRate: e.target.value })}
                      />
                    ) : (
                      fmtCurrency(calc.perCt)
                    )}
                  </td>
                  <td style={styles.tdRight}>{fmtCurrency(calc.total)}</td>
                  <td style={styles.tdRight}>{fmtCurrency(calc.settingTotal)}</td>
                  <td style={{ ...styles.td, fontSize: 11, color: "var(--muted)" }}>{calc.settingType}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={styles.td} colSpan={7}>
                Totals
              </td>
              <td style={styles.tdRight}>{fmt(totals.totalPcs, 0)}</td>
              <td style={styles.tdRight}>{fmt(totals.totalWt, 3)}</td>
              <td></td>
              <td style={styles.tdRight}>{fmtCurrency(totals.diamondTotal)}</td>
              <td style={styles.tdRight}>{fmtCurrency(totals.settingTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BreakupSummary({
  casting,
  labor,
  cadFee,
  cadType,
  diamondTotal,
  settingTotal,
  grossTotalUSD,
  locInfo,
  fxRate,
  totalWithDutyUSD,
  totalWithDutyLocal,
  breakupPct,
  sspCode,
}) {
  const items = [
    { label: "Casting", value: casting },
    { label: "Labor", value: labor },
    { label: `CAD · ${cadType}`, value: cadFee },
    { label: "Diamonds", value: diamondTotal },
    { label: "Setting", value: settingTotal },
  ];
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="05" title="Quote breakdown" />
      <div style={styles.breakupGrid}>
        {items.map((it) => (
          <div key={it.label} style={styles.metricCard}>
            <div style={styles.metricTab} />
            <div style={styles.metricLabel}>{it.label}</div>
            <div style={styles.metricValue}>{fmtCurrency(it.value)}</div>
            <div style={styles.metricPct}>{fmt(breakupPct(it.value), 1)}% of total</div>
          </div>
        ))}
      </div>
      <div style={styles.divider} />
      <div style={styles.totalsGrid}>
        <div style={styles.totalBlockMuted}>
          <div style={styles.metricLabelOnDark}>Gross total · USD</div>
          <div style={styles.bigValueMuted}>{fmtCurrency(grossTotalUSD)}</div>
        </div>
        <div style={styles.totalBlockMuted}>
          <div style={styles.metricLabelOnDark}>With {(locInfo.duty * 100).toFixed(0)}% duty · USD</div>
          <div style={styles.bigValueMuted}>{fmtCurrency(totalWithDutyUSD)}</div>
        </div>
        <div style={styles.totalBlock}>
          <div style={styles.metricLabelOnDark}>
            {locInfo.code} total · {locInfo.currency}
          </div>
          <div style={styles.bigValue}>{fmtCurrency(totalWithDutyLocal)}</div>
          <div style={styles.fxNote}>fx rate {fmt(fxRate, 3)} · SSP: {sspCode}</div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ eyebrow, title, noMargin }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: noMargin ? 0 : 12 }}>
      <span style={styles.eyebrow}>{eyebrow}</span>
      <span style={styles.panelTitle}>{title}</span>
    </div>
  );
}

function Field({ label, children, grow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: grow ? 1 : "0 0 auto" }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

/* ============================================================
   STYLES — "Atelier Rose" design system
   ============================================================ */

const ROSE = "#9C4A63";
const ROSE_DARK = "#6E2F42";
const ROSE_TINT = "#FBEEF2";
const ROSE_TINT_STRONG = "#F3DCE3";
const INK = "#241B1E";
const MUTED = "#8B7680";

const styles = {
  app: {
    "--muted": MUTED,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    background: "#FFFCFD",
    color: INK,
    fontSize: 14,
    minHeight: "100%",
  },
  shell: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "20px 24px 40px",
  },
  topBar: {
    background: INK,
    borderBottom: `3px solid ${ROSE}`,
  },
  topBarInner: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "14px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandBlock: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: ROSE,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 0.5,
    fontFamily: '"Playfair Display", Georgia, serif',
  },
  brandTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: '"Playfair Display", Georgia, serif',
    letterSpacing: 0.2,
  },
  brandSub: { color: "#D8B7C2", fontSize: 11.5, marginTop: 1 },
  topBarActions: { display: "flex", gap: 10 },
  uploadBtn: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 500,
    color: "#fff",
    background: "transparent",
    border: "1px solid #5A4750",
    borderRadius: 6,
    padding: "8px 14px",
    cursor: "pointer",
  },
  pdfStatusBar: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "8px 24px",
    background: "#332229",
    color: "#E9CCD5",
    fontSize: 12.5,
  },
  card: {
    background: "#FFFFFF",
    border: `1px solid ${ROSE_TINT_STRONG}`,
    borderRadius: 10,
    padding: "18px 20px",
    marginTop: 14,
  },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: 700,
    color: ROSE,
    letterSpacing: 1,
    background: ROSE_TINT,
    padding: "2px 7px",
    borderRadius: 4,
  },
  panelTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: INK,
    fontFamily: '"Playfair Display", Georgia, serif',
  },
  rateStatus: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  smallBtn: {
    fontSize: 11.5,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    background: ROSE_TINT,
    color: ROSE_DARK,
    cursor: "pointer",
    fontWeight: 500,
  },
  warnBanner: {
    background: "#FDF6E8",
    border: "1px solid #EAD9A8",
    color: "#7A5B12",
    fontSize: 12,
    padding: "8px 10px",
    borderRadius: 6,
    margin: "10px 0",
  },
  tableSourceRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  importMetaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 },
  importChip: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 12,
    background: "#F7EEDD",
    color: "#7A5B12",
    fontWeight: 600,
  },
  flagPill: {
    fontSize: 10.5,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#FCE8D6",
    color: "#9A4A16",
    fontWeight: 600,
  },
  okPill: {
    fontSize: 10.5,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#E3F0E8",
    color: "#2F6B45",
    fontWeight: 600,
  },
  sourcePill: {
    fontSize: 10.5,
    padding: "3px 8px",
    borderRadius: 10,
    background: "#F3EEEF",
    color: MUTED,
    fontWeight: 500,
  },
  sourcePillLive: { background: ROSE_TINT, color: ROSE_DARK },
  syncNote: { fontSize: 11, color: MUTED, marginTop: 6 },
  fieldRow: { display: "flex", gap: 14, flexWrap: "wrap" },
  label: { fontSize: 10.5, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    height: 33,
    padding: "0 9px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    fontSize: 13,
    background: "#fff",
    minWidth: 110,
    color: INK,
  },
  inputSm: {
    height: 28,
    padding: "0 6px",
    borderRadius: 5,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    fontSize: 12,
    background: "#fff",
    width: 100,
    color: INK,
  },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 0 },
  table: { fontSize: 12.5, marginTop: 10 },
  theadRow: { borderBottom: `2px solid ${ROSE_TINT_STRONG}` },
  th: { padding: "6px 8px", color: MUTED, fontWeight: 600, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 },
  thRight: {
    padding: "6px 8px",
    color: MUTED,
    fontWeight: 600,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right",
  },
  tr: { borderBottom: "1px solid #F6E9ED" },
  trActive: { background: "#FFFCFD" },
  td: { padding: "7px 8px", verticalAlign: "middle" },
  tdRight: { padding: "7px 8px", verticalAlign: "middle", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  totalRow: { borderTop: `2px solid ${ROSE_TINT_STRONG}`, fontWeight: 600, background: ROSE_TINT },
  totalGramNote: { marginTop: 10, fontSize: 12, color: MUTED, textAlign: "right" },
  posBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    fontSize: 11,
    fontWeight: 600,
    background: "#F3EEEF",
    color: MUTED,
  },
  posBadgeActive: { background: ROSE, color: "#fff" },
  toggleGroup: { display: "flex", gap: 6 },
  toggleBtn: {
    fontSize: 12.5,
    padding: "7px 16px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    background: "#fff",
    cursor: "pointer",
    color: INK,
    fontWeight: 500,
  },
  toggleBtnActive: { background: ROSE, color: "#fff", borderColor: ROSE },
  breakupGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 },
  metricCard: {
    position: "relative",
    background: ROSE_TINT,
    borderRadius: 8,
    padding: "14px 14px 12px",
    overflow: "hidden",
  },
  metricTab: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: ROSE,
  },
  metricLabel: { fontSize: 11, color: ROSE_DARK, fontWeight: 600, marginBottom: 4 },
  metricValue: { fontSize: 18, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  metricPct: { fontSize: 10.5, color: MUTED, marginTop: 3 },
  divider: { height: 1, background: ROSE_TINT_STRONG, margin: "18px 0" },
  totalsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 },
  totalBlockMuted: { background: "#2E2227", borderRadius: 8, padding: "16px 18px" },
  totalBlock: { background: ROSE_DARK, borderRadius: 8, padding: "16px 18px" },
  metricLabelOnDark: { fontSize: 11, color: "#D8B7C2", fontWeight: 600, marginBottom: 6 },
  bigValueMuted: { fontSize: 21, fontWeight: 700, color: "#F1E2E6", fontVariantNumeric: "tabular-nums" },
  bigValue: { fontSize: 23, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" },
  fxNote: { fontSize: 10.5, color: "#D8B7C2", marginTop: 4 },
};
