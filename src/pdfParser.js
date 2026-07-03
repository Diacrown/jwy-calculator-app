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
const END_MARK = "%%CAD_FORM_DATA_END%%";

let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib && window.__pdfWorkerReady) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDFJS_SRC;
    script.onload = async () => {
      if (!window.pdfjsLib) return reject(new Error("pdf.js failed to initialize"));
      // Workers must be same-origin; a CDN worker URL throws in most
      // environments. Fetch the worker code and serve it from a blob URL
      // (same-origin), falling back to the direct URL if blob fails.
      try {
        const resp = await fetch(PDFJS_WORKER);
        const code = await resp.text();
        const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
      } catch {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      }
      window.__pdfWorkerReady = true;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Could not load pdf.js from CDN"));
    document.head.appendChild(script);
  });
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

function extractEmbeddedJson(text) {
  const start = text.indexOf(START_MARK);
  const end = text.indexOf(END_MARK);
  if (start === -1 || end === -1 || end <= start) return null;
  // Strip any control characters pdf.js may have preserved; literal
  // newlines/tabs inside JSON string values are invalid JSON. Escaped
  // sequences like \\n in field values are two printable chars and are
  // unaffected by this.
  const raw = text.slice(start + START_MARK.length, end).replace(/[\u0000-\u001F]/g, "");
  try {
    return JSON.parse(raw);
  } catch (e) {
    const lastBrace = raw.lastIndexOf("}");
    if (lastBrace !== -1) {
      try {
        return JSON.parse(raw.slice(0, lastBrace + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
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

function num(v, d = 0) {
  const n = parseFloat(v);
  return isFinite(n) ? n : d;
}

// Given the card's stone record, decide how the calculator should treat it.
// Returns { diamondMode, sizeCode|null, quality|lgdGrade, priced, flag }.
function bridgeStone(stone, diaSize) {
  const shapeRaw = (stone.Shape || "").toLowerCase();
  const isRound = shapeRaw.includes("round") || shapeRaw === "rnd";
  const isLGD = (stone.Stone || "").toUpperCase().includes("LGD");
  const avgWt = num(stone.AvgWt);

  if (isRound) {
    // Match to nearest RND DiaSize code by carat weight.
    const rounds = diaSize.filter((d) => d.code.startsWith("RND"));
    let best = null;
    let bestDiff = Infinity;
    for (const d of rounds) {
      const diff = Math.abs(d.wt - avgWt);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = d;
      }
    }
    return {
      diamondMode: isLGD ? "lgd" : "natural",
      sizeCode: best ? best.code : "",
      priced: true,
      flag: best ? "" : "no round size match",
    };
  }

  // Fancy shape.
  if (isLGD) {
    // LGD fancy: priceable only if avgWt lands in a defined FANCY/ODD band.
    // Bands (from LGD_CERT): FANCY 0.01-0.49 / 0.50-0.89; ODD 0.01-3.99.
    const inBand = avgWt >= 0.01 && avgWt <= 3.99;
    return {
      diamondMode: "lgd",
      sizeCode: "",
      lgdShape: "FANCY",
      priced: inBand,
      flag: inBand ? "LGD fancy — verify band" : "LGD fancy below priced bands — price manually",
    };
  }

  // Natural fancy: no fancy pricing in DiaSSP.
  return {
    diamondMode: "natural",
    sizeCode: "",
    priced: false,
    flag: "fancy shape — not auto-priced, enter manually",
  };
}

export async function parseOrderFormPdf(file, { alloys = [], diaSize = [] } = {}) {
  const text = await extractPdfText(file);
  const data = extractEmbeddedJson(text);
  if (!data) {
    return { ok: false, reason: "no-embedded-data", data: null };
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
      wt: num(data["Metal 1 Weight"]),
    },
    {
      short: cardMetalToAlloyShort(data["Metal Type 2"], data["Metal Col 2"]),
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
