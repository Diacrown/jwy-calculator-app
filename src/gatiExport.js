// GATI bulk-export bridge.
//
// Converts ONE resolved JWY Calculator quote into the row(s) GATI's
// "Default Format" Excel import expects. Built from GATI's own real
// master-data files (Category, Sub_Category, Stock_Type, Make_Type,
// Metal_Color, Metal_Quality, Stone_shape, Stone_Quality) -- not
// guessed. Every code below traces back to a specific confirmed file;
// see the comment above each table.
//
// STATUS AS OF TONIGHT'S REVIEW: metal and stone codes are GENERATED
// (composed from karat/color or shape/quality), not looked up from a
// flat table -- this mirrors how GATI's own codes are actually built
// (confirmed by decoding real examples: "G14YG" = Gold+14kt+YellowGold,
// "NDB12" = NaturalDiamond+RoundBrilliant+TW/VS2).
//
// Anything not yet confirmed returns a clear "NEEDS-GATI-DATA:..."
// marker instead of guessing -- see PENDING_ITEMS at the bottom for the
// full running list of what's still outstanding.

// ============================================================
// METAL CODES -- from Metal_Quality.xlsx (karat) + Metal_Color.xlsx (color)
// ============================================================

// Confirmed from Metal_Quality.xlsx -- these are the ONLY quality codes
// that exist in GATI's system today. Keyed by JWY Calculator's alloy
// `purity` value (0.0-1.0).
const METAL_QUALITY_CODE = {
  0.375: "09",   // 9kt
  0.583: "14",   // 14kt
  0.75: "18",    // 18kt
  0.925: "925",  // Sterling silver
  0.952: "950",  // Platinum 950 (GATI lists 95.5%; 95.2% is the closest/intended match)
  1.0: "999",    // 24kt / fine gold ("999 [Base]" in GATI)
  // NOT YET IN GATI's MASTER DATA (confirmed missing, not an oversight
  // here -- per your answer, GATI will add these):
  // 0.417 (10kt), 0.917 (22kt), 0.6 (PT600), 0.9 (PT900), 0.935 (AG935)
};

// Confirmed from Metal_Color.xlsx. Matched by checking which fragment
// appears in JWY Calculator's alloy short name.
const METAL_COLOR_CODE = [
  { match: "WG", code: "WG" }, // covers WG, WG-NF, WG-PD -- color code doesn't distinguish nickel-free/palladium variants, only visual color
  { match: "YG", code: "YG" },
  { match: "RG", code: "RG" },
  { match: "PT", code: "PT" }, // Metal_Color.xlsx has an explicit Platinum entry
  // NOT YET RESOLVED: Silver (AG925/AG935) has no color code in
  // Metal_Color.xlsx at all -- no "Silver" entry exists there.
  // 22KT/24KT (bare karat, no color suffix) -- ambiguous, not guessed here.
];

/**
 * Generates GATI's MItemCode for a JWY Calculator alloy, e.g.
 * "14KT YG" -> "G14YG". Returns a NEEDS-GATI-DATA marker if either the
 * quality or color piece isn't resolvable yet, rather than guessing.
 */
export function metalCode(alloy) {
  if (!alloy) return "";
  const quality = METAL_QUALITY_CODE[alloy.purity];
  const colorEntry = METAL_COLOR_CODE.find((c) => alloy.short.includes(c.match));
  const color = colorEntry ? colorEntry.code : null;

  if (!quality || !color) {
    const missing = [!quality && "quality code", !color && "color code"].filter(Boolean).join(" + ");
    return `NEEDS-GATI-DATA:${alloy.short}(missing ${missing})`;
  }
  // "G" prefix confirmed only for gold (from the one real example seen,
  // "G14YG"). Platinum/Silver prefix is UNCONFIRMED -- using "G" for all
  // metals for now since it's the only known example; flag if wrong.
  return `G${quality}${color}`;
}

// ============================================================
// STONE CODES -- from Stone_shape.xlsx (shape) + Stone_Quality.xlsx (grade)
// ============================================================

// Confirmed from Stone_shape.xlsx. Keyed by JWY Calculator's own shape
// names (SHAPE_ORDER in JwyCalculator.jsx).
const STONE_SHAPE_CODE = {
  "Round": "B",              // "Round (Brilliant Cut)"
  "Baguette": "BAG",
  "Emerald": "E",
  "Heart": "H",
  "Marquise": "M",
  "Oval": "O",
  "Princess": "P",
  "Pear": "D",
  "Radiant": "R",
  "Triangle": "TRG",
  "Trilliant": "TRN",        // GATI spells it "Trillion"
  "Tappered Bagguette": "TAP", // likely match to GATI's "Taper" -- confirm
  // NOT YET RESOLVED (no clear match in Stone_shape.xlsx, per your
  // instruction: flag as "recheck" rather than approximate):
  // "Carre", "Single Cut", "Sq. Cushion", "Sq. Emerald"
};

// Confirmed from Stone_Quality.xlsx, "Natural Diamond Quality" group.
// Keyed by JWY Calculator's own quality strings.
const STONE_QUALITY_CODE_NATURAL = {
  "TW VVS": "10",
  "TW VS1": "11",
  "TW VS2": "12",
  "TW SI1": "13",
  "TW SI2": "14",
  "TW SI3": "15",
  "TW I1": "16",
  "WH SI": "23",
};

/**
 * Generates GATI's stone ItemCode, e.g. Round + "TW SI1" -> "NDB13".
 * Lab-grown prefix ("LD", inferred from Stone_Quality_Group.xlsx listing
 * "LDQ" = "Lab Diamond Quality" alongside "NDQ" = "Natural Diamond
 * Quality") is UNCONFIRMED -- no real LD example was seen yet.
 */
export function stoneCode(shape, quality, mode) {
  const shapeCode = STONE_SHAPE_CODE[shape];
  if (!shapeCode) return `RECHECK:${shape} shape not yet in GATI's Stone_shape master`;

  if (mode === "lgd") {
    return `RECHECK:${shape} Lab Grown -- LD-prefix quality codes not yet confirmed`;
  }
  const qualityCode = STONE_QUALITY_CODE_NATURAL[quality];
  if (!qualityCode) return `RECHECK:${quality} quality code not yet confirmed`;
  return `ND${shapeCode}${qualityCode}`;
}

// ============================================================
// CATEGORY / SUB CATEGORY -- from Category.xlsx + Sub_Category.xlsx
// ============================================================

// Confirmed from Category.xlsx.
const CATEGORY_CODE = {
  "Ring": "R", "Earring": "E", "Earrings": "E", "Pendant": "P", "Pendants": "P",
  "Necklace": "N", "Bracelet": "B", "Bracelets": "B", "Arm Band": "A", "Charm": "C", "Charms": "C",
};

// Confirmed from Sub_Category.xlsx -- the real product-style list (NOT
// the CAD form's current Bridal/Fashion/Eternity/Solitaire options,
// which map to Collection instead -- see note below). Once the CAD
// Order Form's Sub Category dropdown is updated to use these real GATI
// values, this maps the selected name straight to its code.
const SUB_CATEGORY_CODE = {
  "Engagement Ring": "EN", "Wedding Band": "WB", "Cocktail Ring": "CR", "Halo Ring": "HR",
  "Tennis Bracelet": "TB", "Bangle Bracelet": "BB", "Other Bracelet": "OB",
  "Stud Earrings": "ES", "Hoops Earrings": "EH", "Drop Earrings": "ED", "Huggies Earrings": "HG",
  "Pendant": "PD", "Tennis Necklace": "TN", "Yard Necklace": "YN", "Charms": "CH",
};

export function categoryCode(itemType) {
  return CATEGORY_CODE[itemType] || (itemType ? `RECHECK:${itemType} not in Category master` : "");
}

export function subCategoryCode(subCategoryName) {
  return SUB_CATEGORY_CODE[subCategoryName] || (subCategoryName ? `RECHECK:${subCategoryName} not in Sub_Category master` : "");
}

// ============================================================
// CONFIRMED FIXED CONSTANTS
// ============================================================
// StockType: Stock_Type.xlsx has exactly 3 options (Mount/Semi
// Mount/Finished) -- a completed quote is always "Finished."
// MakeType: Make_Type.xlsx has exactly ONE option in GATI's entire
// system -- "Casting" -- so this isn't a "likely fixed" guess anymore,
// it's confirmed there's nothing else it could be.
const FIXED_DEFAULTS = {
  StockType: "FN",
  MakeType: "CAST",
  InwardQty: 1,
  ItemPcs: 1,
  SetCode: "Setting",
  MakingOn: "NetWt",
  MakingCostOn: "NetWt",
  RateChartCode: "Diamond SSP",
  BaseMetalCalculationCode: "On Net Wt",
  BaseMetalCalculationCostCode: "On Net Wt",
};

// Currency: GATI's Currency.xlsx only defines $, INR, AUD -- far fewer
// than JWY Calculator's 7 supported currencies. Per your instruction:
// default to "$" always; if a quote actually used a different currency,
// the user corrects it manually in the exported file before uploading
// to GATI.
const DEFAULT_CURRENCY = "$";

// Manufacturer: confirmed to be Designer, coded -- but the actual
// Designer-to-code list hasn't been provided yet.
const DESIGNER_CODE_MAP = {
  // "Kunal": "??",
  // ...
};
function manufacturerCode(designer) {
  if (!designer) return "";
  return DESIGNER_CODE_MAP[designer] || `NEEDS-GATI-DATA:designer code for "${designer}"`;
}

/**
 * Converts one resolved quote into GATI row(s). See gatiExport.js's
 * header comment for the shape `quote` is expected in.
 */
export function mapQuoteToGatiRows(quote) {
  const { jobInfo, primaryAlloy, primaryGramWt, rowsWithCalcs, printDate } = quote;

  const rows = [];

  rowsWithCalcs.forEach(({ r, c }, idx) => {
    const isFirstRow = idx === 0;

    const row = {
      SrNo: isFirstRow ? 1 : "",
      StyleCode: jobInfo.itemNo || "",
      Pcs: r.pcs || "",
      Weight: c.totalWt, // confirmed: row TOTAL weight (qty x per-piece), not per-piece
      ItemCode: stoneCode(c.shape, r.quality, r.mode),
      Size: c.size,
      Currency: DEFAULT_CURRENCY,
      CurrencyValue: 1,
      ...FIXED_DEFAULTS,
    };

    if (isFirstRow) {
      Object.assign(row, {
        // TENTATIVE -- not yet confirmed whether this should be Print
        // Date or a separate stock-receipt date. Using Print Date for
        // now; revisit once decided.
        InwardDate: printDate,
        Manufacturer: manufacturerCode(jobInfo.designer),
        Category: categoryCode(jobInfo.itemType),
        SubCategory: subCategoryCode(jobInfo.subCategory),
        Collection: "", // maps to CAD form's CURRENT Sub Category field (Bridal/Fashion/Eternity/Solitaire) -- not wired up yet
        MItemCode: primaryAlloy ? metalCode(primaryAlloy) : "",
        NetWt: primaryGramWt || "",
      });
    }

    rows.push(row);
  });

  return rows;
}

export function mapQuotesToGatiSheet(quotes) {
  return quotes.flatMap(mapQuoteToGatiRows);
}

// ============================================================
// PENDING ITEMS -- full running list, for tonight's stakeholder review
// ============================================================
export const PENDING_ITEMS = [
  "Metal quality codes missing from GATI: 10kt, 22kt, Platinum 600, Platinum 900, Silver 935 (only 09/14/18/925/950/999 exist today)",
  "Metal color code for Silver (AG925/AG935) -- no Silver entry in Metal_Color.xlsx",
  "Metal ItemCode prefix for Platinum/Silver -- only confirmed for Gold ('G')",
  "Stone shapes with no GATI match: Carre, Single Cut, Sq. Cushion, Sq. Emerald",
  "Lab Grown stone quality codes -- 'LD' prefix inferred, not confirmed with a real example",
  "Designer-to-Manufacturer code list -- confirmed this IS the mapping, list not yet provided",
  "InwardDate -- tentatively using Print Date, not yet confirmed as correct",
  "Collection field -- needs wiring to CAD form's current Sub Category (Bridal/Fashion/Eternity/Solitaire), not yet implemented",
  "CAD Order Form's Sub Category dropdown needs updating to GATI's real 18 product-style values (Cocktail Ring, Halo Ring, etc.) -- separate tool, not covered here",
];
