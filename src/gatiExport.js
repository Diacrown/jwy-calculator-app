// GATI bulk-export bridge.
//
// Converts ONE resolved JWY Calculator quote into GATI row(s) matching
// their FULL "Default Format" Excel structure -- all 214 columns, in
// exact order, even where most are legitimately blank. GATI's importer
// expects the full column structure to actually align data correctly;
// omitting unused columns (rather than leaving them blank) breaks the
// upload, per direct testing.
//
// IMPORTANT CORRECTION (found via a real test upload): GATI's actual
// import wants full descriptive NAMES for most fields ("Finished",
// "Casting", "Cocktail Ring"), NOT the short codes from the reference
// master files (FN, CAST, CR) -- those codes are just a lookup/legend,
// not what the import itself expects. Category is the one confirmed
// exception -- it genuinely does want the short code ("R"), confirmed
// directly against the real sample row.

// ============================================================
// FULL 214-COLUMN HEADER LIST, exact order, from your real
// sjeplus_format_new.xlsx "Default Format" sheet.
// ============================================================
export const GATI_COLUMNS = [
  "SrNo","InwardDate","JewelCode","JewelAliasNo","StyleCode","Manufacturer","Category","SubCategory",
  "StockType","MakeType","InwardQty","ItemPcs","Collection","isBaseCollection","ItemSize","ItemCode",
  "Size","SetCode","RawFormula","Pcs","Weight","Rate","Amount","DisMarkupOn","DisMarkupPer","DisMarkupAmt",
  "CostRate","CostAmount","DisMarkupCostOn","DisMarkupCostPer","DisMarkupCostAmt","MItemCode","NetWt",
  "MRate","MAmt","MDisMarkupOn","MDisMarkupPer","MDisMarkupAmt","MCostRate","MCostAmt","MDisMarkupCostOn",
  "MDisMarkupCostPer","MDisMarkupCostAmt","CPFRate","CPFIsFix","CPFAmt","CPFDisMarkupPer",
  "CPFAmtDisMarkupPer","CPFCostRate","CPFCostIsFix","CPFCostAmt","CPFDisMarkupCostPer",
  "CPFAmtDisMarkupCostPer","MakingOn","MakingCostOn","Remarks","MiscRemarks","Currency","CurrencyValue",
  "RateChartCode","StyleAliasNo","SalePlusPer","SalePlusIsFix","SalePlusAmt","CostPlusPer","CostPlusIsFix",
  "CostPlusAmt","OrderDate","OrderNo","PurchaseOrderNoOrBagNo","PurchaseOrderNoSrNoOrBagNo",
  "OrderCustomerCode","OrderCustomerName","OrderSalesPersonCode","OrderSalesPersonName","Brand","Gender",
  "ItemPoNo","PoNo","PoDate","ExpDelDate","CostDiscountPer","CostDiscountIsFix","CostDiscountAmt",
  "SaleDiscountPer","SaleDiscountIsFix","SaleDiscountAmt","Restricted","IsComplete","TagPrice",
  "ProductCode","ReOrderQty","MasterQty","StampingInstruction","CustomerProductionInstruction",
  "DesignProductionInstruction","SpecialRemarks","StyleHistory","FixPrice","WaxWt","ModelWt",
  "Jewelry_LabName","Jewelry_CertificateNo","BaseMetalCalculationCode","BaseMetalCalculationCostCode",
  "MouldNo","MouldDescription","MouldQty","MouldWtDesc","ExplorationCode","ExplorationValue","Location",
  "Branch","PartyStyle_CustomerName","ReferenceStyleCode","MfgCode","AccessoriesCode","BatchNo",
  "CertiBatchNo","NBatchNo","NRate","Description","SetCostRate","SetCostAmount","SetDisMarkupCostOn",
  "SetDisMarkupCostPer","SetRate","SetAmount","SetDisMarkupOn","SetDisMarkupPer","HandCostRate",
  "HandCostAmount","HandDisMarkupCostOn","HandDisMarkupCostPer","HandRate","HandAmount","HandDisMarkupOn",
  "HandDisMarkupPer","StonePosition","LossPer","MetalLossPerCalcOn","LossPerIsFix","LossWeight",
  "LossCostPer","MetalLossPerCalcCostOn","LossCostPerIsFix","LossCostWeight","MakeDate","HsnName",
  "NotBase_CPFRate","NotBase_CPFIsFix","NotBase_CPFAmt","NotBase_CPFDisMarkupPer",
  "NotBase_CPFAmtDisMarkupPer","NotBase_CPFCostRate","NotBase_CPFCostIsFix","NotBase_CPFCostAmt",
  "NotBase_CPFDisMarkupCostPer","NotBase_CPFAmtDisMarkupCostPer","NotBase_LossPer",
  "NotBase_MetalLossPerCalcOn","NotBase_LossPerIsFix","NotBase_LossWeight","NotBase_LossCostPer",
  "NotBase_MetalLossPerCalcCostOn","NotBase_LossCostPerIsFix","NotBase_LossCostWeight","Parts","MPcs",
  "MAccessoriesCode","MBatchNo","MCertiBatchNo","MNBatchNo","MNRate","MSize","MSetCode","MDescription",
  "MSetCostRate","MSetCostAmount","MSetDisMarkupCostOn","MSetDisMarkupCostPer","MSetRate","MSetAmount",
  "MSetDisMarkupOn","MSetDisMarkupPer","MHandCostRate","MHandCostAmount","MHandDisMarkupCostOn",
  "MHandDisMarkupCostPer","MHandRate","MHandAmount","MHandDisMarkupOn","MHandDisMarkupPer",
  "WebDescription","ParentStyleCode","DesignBy","MinWeight","MaxWeight","StoneWt","DefaultWt",
  "ProductionWeight","MMinWeight","MMaxWeight","MStoneWt","MDefaultWt","MProductionWeight",
  "UnitPriceRounding","UnitCostPriceRounding","RhodiumInstruction","DiamondInstruction","SizeInstruction",
  "EndClientPrice","ProductionRouteCode","JewelryColor",
];

function blankRow() {
  const row = {};
  for (const col of GATI_COLUMNS) row[col] = "";
  return row;
}

// ============================================================
// METAL CODES -- unchanged from before, confirmed correct
// ============================================================
const METAL_QUALITY_CODE = { 0.375: "09", 0.583: "14", 0.75: "18", 0.925: "925", 0.952: "950", 1.0: "999" };
const METAL_COLOR_CODE = [
  { match: "WG", code: "WG" }, { match: "YG", code: "YG" }, { match: "RG", code: "RG" }, { match: "PT", code: "PT" },
];
export function metalCode(alloy) {
  if (!alloy) return "";
  const quality = METAL_QUALITY_CODE[alloy.purity];
  const colorEntry = METAL_COLOR_CODE.find((c) => alloy.short.includes(c.match));
  const color = colorEntry ? colorEntry.code : null;
  if (!quality || !color) {
    const missing = [!quality && "quality code", !color && "color code"].filter(Boolean).join(" + ");
    return `NEEDS-GATI-DATA:${alloy.short}(missing ${missing})`;
  }
  return `G${quality}${color}`;
}

// ============================================================
// STONE CODES -- unchanged, confirmed correct against real example
// ============================================================
const STONE_SHAPE_CODE = {
  "Round": "B", "Baguette": "BAG", "Emerald": "E", "Heart": "H", "Marquise": "M", "Oval": "O",
  "Princess": "P", "Pear": "D", "Radiant": "R", "Triangle": "TRG", "Trilliant": "TRN", "Tappered Bagguette": "TAP",
};
const STONE_QUALITY_CODE_NATURAL = {
  "TW VVS": "10", "TW VS1": "11", "TW VS2": "12", "TW SI1": "13", "TW SI2": "14", "TW SI3": "15", "TW I1": "16", "WH SI": "23",
};
export function stoneCode(shape, quality, mode) {
  const shapeCode = STONE_SHAPE_CODE[shape];
  if (!shapeCode) return `RECHECK:${shape} shape not yet in GATI's Stone_shape master`;
  if (mode === "lgd") return `RECHECK:${shape} Lab Grown -- LD-prefix quality codes not yet confirmed`;
  const qualityCode = STONE_QUALITY_CODE_NATURAL[quality];
  if (!qualityCode) return `RECHECK:${quality} quality code not yet confirmed`;
  return `ND${shapeCode}${qualityCode}`;
}

// Suppresses the app's internal "manual entry" placeholder from ever
// reaching an exported file -- same fix already applied to the PDF.
// GATI should see the actual typed description, or a blank, never the
// literal internal label.
function cleanSize(c) {
  if (c.size === "manual entry") return "";
  return c.size;
}

// ============================================================
// CATEGORY -- confirmed to want the CODE ("R"), unlike most other
// fields which want the full name. Verified directly.
// ============================================================
const CATEGORY_CODE = {
  "Ring": "R", "Earring": "E", "Earrings": "E", "Pendant": "P", "Pendants": "P",
  "Necklace": "N", "Bracelet": "B", "Bracelets": "B", "Arm Band": "A", "Charm": "C", "Charms": "C",
};
export function categoryCode(itemType) {
  return CATEGORY_CODE[itemType] || (itemType ? `RECHECK:${itemType} not in Category master` : "");
}

// ============================================================
// SUB CATEGORY vs COLLECTION -- the CAD Order Form's current "Sub
// Category" dropdown (Bridal/Fashion/Eternity/Solitaire) actually holds
// COLLECTION-style values, not GATI's real SubCategory values (Cocktail
// Ring, Halo Ring, etc, which the CAD form doesn't produce yet). This
// redirects what the CAD form actually sends to the field it actually
// matches, confirmed against Collection.xlsx's real name list.
// ============================================================
const CAD_VALUE_TO_COLLECTION = {
  "Fashion": "Fashion",
  "Solitaire": "Solitaire",
  // "Bridal" and "Eternity" -- confirmed NOT in Collection.xlsx's real
  // list. No clean match exists; flagged rather than guessed.
};

function resolveSubCategoryAndCollection(cadSubCategoryValue) {
  if (!cadSubCategoryValue) return { subCategory: "", collection: "" };
  const collectionMatch = CAD_VALUE_TO_COLLECTION[cadSubCategoryValue];
  if (collectionMatch) {
    return { subCategory: "", collection: collectionMatch };
  }
  return {
    subCategory: "",
    collection: `RECHECK:"${cadSubCategoryValue}" -- no match in Collection.xlsx (only Fashion/Solitaire confirmed so far)`,
  };
}

// ============================================================
// CONFIRMED FIXED VALUES -- full descriptive names, NOT codes, per the
// real sample data (this was the error found in tonight's test file).
// ============================================================
const FIXED_DEFAULTS = {
  StockType: "Finished",
  MakeType: "Casting",
  InwardQty: 1,
  ItemPcs: 1,
  SetCode: "Setting",
  MakingOn: "NetWt",
  MakingCostOn: "NetWt",
  RateChartCode: "Diamond SSP",
  BaseMetalCalculationCode: "On Net Wt",
  BaseMetalCalculationCostCode: "On Net Wt",
};

const DEFAULT_CURRENCY = "$";

// Manufacturer: always defaults to "EL" -- per direct instruction, any
// exception gets corrected manually by the user in the exported file
// rather than derived from Designer.
const DEFAULT_MANUFACTURER = "EL";

// Date format: DD/MM/YYYY, per direct correction on a real test file
// (was previously ISO YYYY-MM-DD).
function formatGatiDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (isNaN(d)) return isoDate;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Converts one resolved quote into full 214-column GATI row(s).
 */
export function mapQuoteToGatiRows(quote) {
  const { jobInfo, primaryAlloy, primaryGramWt, rowsWithCalcs, printDate } = quote;
  const rows = [];

  rowsWithCalcs.forEach(({ r, c }, idx) => {
    const isFirstRow = idx === 0;
    const row = blankRow();

    Object.assign(row, {
      SrNo: isFirstRow ? 1 : "",
      StyleCode: jobInfo.itemNo || "",
      Pcs: r.pcs || "",
      Weight: c.totalWt,
      ItemCode: stoneCode(c.shape, r.quality, r.mode),
      Size: cleanSize(c),
      Currency: DEFAULT_CURRENCY,
      CurrencyValue: 1,
      ...FIXED_DEFAULTS,
    });

    if (isFirstRow) {
      const { subCategory, collection } = resolveSubCategoryAndCollection(jobInfo.subCategory);
      Object.assign(row, {
        InwardDate: formatGatiDate(printDate),
        Manufacturer: DEFAULT_MANUFACTURER,
        Category: categoryCode(jobInfo.itemType),
        SubCategory: subCategory,
        Collection: collection,
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

export const PENDING_ITEMS = [
  "Metal quality codes missing from GATI: 10kt, 22kt, Platinum 600, Platinum 900, Silver 935",
  "Metal color code for Silver -- no Silver entry in Metal_Color.xlsx",
  "Metal ItemCode prefix for Platinum/Silver -- only confirmed for Gold ('G')",
  "Stone shapes with no GATI match: Carre, Single Cut, Sq. Cushion, Sq. Emerald",
  "Lab Grown stone quality codes -- 'LD' prefix inferred, not confirmed",
  "CAD form's Sub Category values 'Bridal' and 'Eternity' -- no match in Collection.xlsx, needs a real answer",
  "CAD Order Form's Sub Category dropdown still needs updating to GATI's real 18 product-style values -- separate tool",
];
