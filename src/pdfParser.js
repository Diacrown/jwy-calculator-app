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

// Map card metal (Type + Color + Extra) to a calculator alloy short code.
// Type covers two different families: direct-match metals (Wax, Brass,
// AG925/935, PT600/900/950) that need no color combination, and karat
// golds (9KT-24KT) that combine with Color (WG/YG/RG) and Extra (NF/PD)
// to form names like "14KT WG-PD". Unmatched combinations are returned
// as-is so the caller's alloy-list check can flag them rather than
// silently guessing.
function cardMetalToAlloyShort(type, color, extra) {
  const t = (type || "").toUpperCase().trim();
  const c = (color || "").toUpperCase().trim();
  const ex = (extra || "").toUpperCase().trim();

  const directCase = { WAX: "Wax", BRASS: "Brass" };
  if (directCase[t]) return directCase[t];
  if (["AG925", "AG935", "PT600", "PT900", "PT950"].includes(t)) return t;

  const ktMatch = t.match(/(\d+)\s*KT/);
  if (!ktMatch) return t; // unrecognized type; flagged upstream via validShort()
  const kt = ktMatch[1];

  if (kt === "22" || kt === "24") return `${kt}KT`; // no color variants for these
  if (!c) return `${kt}KT`;

  // Which WG suffix is even valid depends on BOTH color and karat, not
  // just color -- confirmed against the real Alloys table: 9KT/10KT only
  // have a Nickel-Free variant (WG-NF), 14KT/18KT only have a Palladium
  // variant (WG-PD). There's no "14KT WG-NF" or "9KT WG-PD" at all. A
  // mismatched Extra value (e.g. the form recording "NF" for a 14KT
  // metal) is ignored rather than producing a name that doesn't exist,
  // which would otherwise fail the lookup silently.
  const nfKarats = ["9", "10"];
  const pdKarats = ["14", "18"];
  let suffix = c;
  if (c === "WG") {
    if (ex === "NF" && nfKarats.includes(kt)) suffix = "WG-NF";
    else if (ex === "PD" && pdKarats.includes(kt)) suffix = "WG-PD";
  }
  return `${kt}KT ${suffix}`;
}

function num(v, d = 0) {
  const n = parseFloat(v);
  return isFinite(n) ? n : d;
}

// Given the card's stone record, decide how the calculator should treat
// it. Only exact "Mined" and exact "LGD" stone types get real pricing --
// every other value (CZ, Zircon, Color, Mount, Plain, Semi variants,
// combo types like "Mined+LGD") lands as a custom row since there's no
// pricing data for them yet, with the real stone type preserved in the
// flag so it's clear what it actually is. Rows the form itself marked
// Mode: "custom" are always treated as custom, no exceptions.
function bridgeStone(stone, diaSize) {
  const shapeRaw = (stone.Shape || "").toLowerCase();
  const isRound = shapeRaw.includes("round") || shapeRaw === "rnd";
  const stoneTypeRaw = (stone.Stone || "").trim();
  const stoneTypeUpper = stoneTypeRaw.toUpperCase();
  const avgWt = num(stone.AvgWt);
  const isExplicitCustom = (stone.Mode || "").toLowerCase() === "custom";
  const isPureMined = stoneTypeUpper === "MINED";
  const isPureLGD = stoneTypeUpper === "LGD";

  // Matches by shape name (case-insensitive) against the full catalog,
  // then nearest carat weight within that shape. Used for every shape,
  // not just Round -- this is what lets fancy shapes land in the same
  // Select Size dropdown a manual user would pick from, rather than a
  // disconnected free-text row, even though pricing for fancy naturals
  // still has to be entered manually (no DiaSSP data for those yet).
  const nearestByShape = (shapeName) => {
    const norm = (shapeName || "").toLowerCase().trim();
    const candidates = diaSize.filter((d) => d.shape.toLowerCase() === norm);
    let best = null, bestDiff = Infinity;
    for (const d of candidates) {
      const diff = Math.abs(d.wt - avgWt);
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    return best;
  };

  if (!isExplicitCustom && isPureMined && isRound) {
    const best = nearestByShape("Round");
    return {
      diamondMode: "natural",
      sizeCode: best ? best.key : "",
      matchedShape: best ? best.shape : "",
      priced: true,
      flag: best ? "" : "no round size match",
    };
  }

  if (!isExplicitCustom && isPureLGD) {
    if (isRound) {
      const best = nearestByShape("Round");
      return {
        diamondMode: "lgd",
        sizeCode: best ? best.key : "",
        matchedShape: best ? best.shape : "",
        priced: true,
        flag: best ? "" : "no round size match",
      };
    }
    const isOdd = isOddShape(stone.Shape);
    const lgdShape = isOdd ? "ODD" : "FANCY";
    const inBand = avgWt >= 0.01 && avgWt <= 3.99;
    // LGD fancy prices from the band tables regardless of DiaSize match,
    // but matching still gives the row a proper shape/size selection
    // instead of leaving it blank.
    const best = nearestByShape(stone.Shape);
    return {
      diamondMode: "lgd",
      sizeCode: best ? best.key : "",
      matchedShape: best ? best.shape : "",
      lgdShape,
      priced: inBand,
      flag: inBand ? (isOdd ? "auto-classified as ODD — verify" : "") : "LGD below priced bands",
    };
  }

  if (!isExplicitCustom && isPureMined) {
    // Mined but fancy-shaped: no DiaSSP price for fancy naturals. Try to
    // match the shape+weight against the full catalog anyway, so the row
    // gets a real Select Size entry (dims, canonical weight) with an
    // editable $/ct rather than free text. Only fall back to a true
    // custom row if the shape genuinely isn't in the catalog at all.
    const best = nearestByShape(stone.Shape);
    const oddNat = isOddShape(stone.Shape);
    if (best) {
      return {
        diamondMode: "natural",
        sizeCode: best.key,
        matchedShape: best.shape,
        priced: false,
        flag: oddNat ? "odd shape — enter $/ct manually" : "fancy natural — enter $/ct manually",
      };
    }
    return {
      diamondMode: "natural",
      isCustom: true,
      customShape: stone.Shape || "",
      customWt: avgWt,
      priced: false,
      flag: "shape not in catalog — enter details manually",
    };
  }

  // Explicit custom-mode rows, and any stone type without pricing data
  // (CZ, Zircon, Color, Mount, Plain, Semi variants, "Mined+LGD" and
  // other combos). Always lands as an editable custom row.
  let flag;
  if (isExplicitCustom) {
    flag = "custom row from form — enter $/ct manually";
  } else if (!stoneTypeRaw) {
    flag = "no stone type specified — enter $/ct manually";
  } else {
    flag = `"${stoneTypeRaw}" has no pricing data yet — enter $/ct manually`;
  }
  return {
    diamondMode: "natural",
    isCustom: true,
    customShape: stone.Shape || "",
    customWt: avgWt,
    priced: false,
    flag,
  };
}

export async function parseOrderFormPdf(file, { alloys = [], diaSize = [] } = {}) {
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
      short: cardMetalToAlloyShort(data["Metal Type 1"], data["Metal Col 1"], data["Metal Extra 1"]),
      wt: num(data["Metal 1 Weight"]),
    },
    {
      short: cardMetalToAlloyShort(data["Metal Type 2"], data["Metal Col 2"], data["Metal Extra 2"]),
      wt: num(data["Metal 2 Weight"]),
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
    .filter((s) => s.Shape && num(s.Qty) > 0)
    .map((s) => {
      const bridge = bridgeStone(s, diaSize);
      return {
        pos: s.Pos || "",
        stoneType: s.Stone || "",
        shape: s.Shape || "",
        dims: [s.L, s.W, s.H].filter(Boolean).join(" x "),
        avgWt: num(s.AvgWt),
        qty: num(s.Qty),
        totalWt: num(s.Tot),
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
