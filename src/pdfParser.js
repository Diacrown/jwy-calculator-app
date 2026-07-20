// CAD Order Form data parser.
//
// Reads the order-data JSON exported directly by the CAD Order Form's
// "Export Order Data" button -- the same schema the form used to embed
// in PDFs, but without any of the PDF/text-extraction fragility (no
// pdf.js, no truncation risk, images come through reliably every time).
// PDF import was removed: it depended on scraping a hidden marker back
// out of a rendered PDF via pdf.js, which was fragile in practice
// (truncation on image-heavy cards, inconsistent extraction across
// browsers). JSON export from the form is the reliable path.

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
  // The form signals "this row was manually entered, not picked from the
  // size dropdown" two different ways depending on context: Mode="custom"
  // at the row level, or SizeIdx="custom" specifically on the size field
  // (seen on center stones the designer types a carat weight for directly,
  // e.g. a 1ct+ center stone that's nowhere near melee/catalog range).
  // Either one means: don't try to catalog-match this row.
  const isExplicitCustom =
    (stone.Mode || "").toLowerCase() === "custom" ||
    (stone.SizeIdx || "").toLowerCase() === "custom";
  const isPureMined = stoneTypeUpper === "MINED";
  // The CAD form's Stone dropdown wording has changed over time -- older
  // exports use the abbreviation "LGD", newer ones spell out "Lab grown".
  // Both mean the same thing for pricing purposes.
  const isPureLGD = stoneTypeUpper === "LGD" || stoneTypeUpper === "LAB GROWN";

  // Matches by shape name (case-insensitive) against the full catalog,
  // then nearest carat weight within that shape. Used for every shape,
  // not just Round -- this is what lets fancy shapes land in the same
  // Select Size dropdown a manual user would pick from, rather than a
  // disconnected free-text row, even though pricing for fancy naturals
  // still has to be entered manually (no DiaSSP data for those yet).
  //
  // Includes a tolerance check: a "nearest" match is only accepted if
  // it's reasonably close to the actual weight. Without this, a 1ct+
  // center stone (well outside melee/catalog range, which tops out
  // around 0.2-0.3ct for most fancy shapes) would silently snap to the
  // largest available catalog entry -- technically "the closest one"
  // but a materially wrong match, not a real substitute.
  const nearestByShape = (shapeName) => {
    const norm = (shapeName || "").toLowerCase().trim();
    const candidates = diaSize.filter((d) => d.shape.toLowerCase() === norm);
    let best = null, bestDiff = Infinity;
    for (const d of candidates) {
      const diff = Math.abs(d.wt - avgWt);
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    if (!best) return null;
    const relDiff = bestDiff / Math.max(avgWt, best.wt, 0.001);
    if (relDiff > 0.35) return null; // too far off to call it a match
    return best;
  };

  if (!isExplicitCustom && isPureMined && isRound) {
    const best = nearestByShape("Round");
    return {
      diamondMode: "natural",
      sizeCode: best ? best.key : "",
      matchedShape: best ? best.shape : "",
      priced: !!best,
      isCustom: !best,
      customShape: best ? undefined : stone.Shape || "",
      customWt: best ? undefined : avgWt,
      flag: best ? "" : "no catalog size close enough — enter details manually",
    };
  }

  if (!isExplicitCustom && isPureLGD) {
    if (isRound) {
      const best = nearestByShape("Round");
      if (best) {
        return {
          diamondMode: "lgd",
          sizeCode: best.key,
          matchedShape: best.shape,
          priced: true,
          flag: "",
        };
      }
      // No close round match (e.g. a large round center stone) -- land
      // as a custom LGD row rather than snapping to the nearest melee size.
      return {
        diamondMode: "lgd",
        isCustom: true,
        customShape: stone.Shape || "",
        customWt: avgWt,
        priced: false,
        flag: "no catalog size close enough — enter $/ct manually",
      };
    }
    const isOdd = isOddShape(stone.Shape);
    const lgdShape = isOdd ? "ODD" : "FANCY";
    const inBand = avgWt >= 0.01 && avgWt <= 3.99;
    // LGD fancy prices from the band tables regardless of DiaSize match,
    // but matching still gives the row a proper shape/size selection
    // instead of leaving it blank.
    const best = nearestByShape(stone.Shape);
    if (!best) {
      // Shape+weight doesn't correspond to anything in our size catalog
      // (typical for a large center stone) -- still price from the LGD
      // band if the weight qualifies, but as a custom row so the shape
      // and weight shown are exactly what the card says, not a
      // mismatched catalog entry.
      return {
        diamondMode: "lgd",
        isCustom: true,
        customShape: stone.Shape || "",
        customWt: avgWt,
        lgdShape,
        priced: inBand,
        flag: inBand
          ? "large/custom stone — priced via LGD band, verify"
          : "LGD below priced bands — enter $/ct manually",
      };
    }
    return {
      diamondMode: "lgd",
      sizeCode: best.key,
      matchedShape: best.shape,
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
    // custom row if the shape genuinely isn't in the catalog at all, or
    // no close-enough match exists (e.g. a large center stone).
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
      flag: "shape/size not in catalog — enter details manually",
    };
  }

  // Explicit custom-mode rows, and any stone type without pricing data
  // (CZ, Zircon, Color, Mount, Plain, Semi variants, "Mined+LGD" and
  // other combos). Always lands as an editable custom row. Mode is
  // preserved as natural vs lgd based on the card's own Stone field, so
  // an imported custom LGD stone doesn't default to the wrong toggle.
  let flag;
  if (isExplicitCustom) {
    flag = "custom row from form — enter $/ct manually";
  } else if (!stoneTypeRaw) {
    flag = "no stone type specified — enter $/ct manually";
  } else {
    flag = `"${stoneTypeRaw}" has no pricing data yet — enter $/ct manually`;
  }
  return {
    diamondMode: isPureLGD ? "lgd" : "natural",
    isCustom: true,
    customShape: stone.Shape || "",
    customWt: avgWt,
    priced: false,
    flag,
  };
}

// The actual field-mapping logic, shared by both import paths (PDF
// extraction and direct JSON import) so there's exactly one place that
// defines how card data becomes calculator state -- no drift between
// the two entry points.
function mapFormDataToCalculator(data, { alloys = [], diaSize = [] } = {}) {
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

  // --- Images (best-effort) ---
  // _VERSIONS and _CLIENT_REF_IMAGES are the largest fields in the JSON
  // (full base64 image data) and sit near the end of the key order, so
  // they're the most likely to be missing if pdf.js's extraction got
  // truncated before reaching them. Absence here just means the quote
  // prints without images -- it's not an error. When importing directly
  // from JSON (no PDF involved) these are far more likely to be present,
  // since there's no text-extraction truncation risk at all.
  const versions = Array.isArray(data["_VERSIONS"]) ? data["_VERSIONS"] : [];
  const clientRefImagesRaw = Array.isArray(data["_CLIENT_REF_IMAGES"]) ? data["_CLIENT_REF_IMAGES"] : [];
  const cadImageDataUrls = versions.filter((v) => v && v.dataUrl).map((v) => v.dataUrl);
  const clientRefImageDataUrls = clientRefImagesRaw.filter((v) => v && v.dataUrl).map((v) => v.dataUrl);

  // Derived summary fields the form itself computes (informational only
  // -- metals and stones for actual pricing still come from the raw
  // fields/_RAW_STONES above, which are more granular; these are just
  // useful for the reviewer to cross-check at a glance).
  const derivedSummary = {
    metalTypeCombined: data["_METAL_TYPE_COMBINED"] || "",
    metalColorCombined: data["_METAL_COLOR_COMBINED"] || "",
    stoneQty: data["_STONE_QTY"] || "",
    stoneTypes: data["_STONE_TYPES"] || "",
    stoneSources: data["_STONE_SOURCES"] || "",
    stoneSettings: data["_STONE_SETTINGS"] || "",
  };

  return { jobInfo, metals, metalWarnings, stones, cadImageDataUrls, clientRefImageDataUrls, derivedSummary, rawJson: data };
}

export function parseOrderFormJson(input, { alloys = [], diaSize = [] } = {}) {
  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch (e) {
    return { ok: false, reason: "invalid-json", data: null, diag: "Could not parse as JSON: " + e.message };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "invalid-json", data: null, diag: "Parsed value is not an object" };
  }
  if (!("JobNo" in data) && !("_RAW_STONES" in data)) {
    return {
      ok: false,
      reason: "unrecognized-schema",
      data: null,
      diag: "This doesn't look like CAD order form data (no JobNo or _RAW_STONES field)",
    };
  }
  return { ok: true, data: mapFormDataToCalculator(data, { alloys, diaSize }) };
}
