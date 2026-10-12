// Purchase Order data mapping -- turns one resolved Calculator quote into the
// plain values the PO PDF (poDocument.jsx) prints. Kept separate from the
// PDF layout so the rules below can be read (and changed) in one place.
//
// The PO and "Export to Main File" are two views of the same job, so the
// metal / rhodium / stone-type wording is taken from the same helpers the
// Main File export uses (jobTrackerExport.js) and the two can't drift.
//
// Rules (as specified):
//   PO Number   = the Calculator's Job #
//   Order Qty   = "1 Pcs" for earrings, "1 Pc" for every other item type
//   Your Style# = the Vendor Item No (blank when that's blank)
//   Order Date  = PO Date from the Job Tracker details panel (falls back to
//                 the quote date); Due Date = Due Date from the same panel
//   Stone lines = shape + colour + size + weight (single stone only) + pcs,
//                 then the row's Proposed Quality underneath -- never the
//                 internal pricing grade.

import {
  cleanSize,
  splitMetal,
  resolveMetalColor,
  resolveRhodium,
  stoneTypeLabel,
  PLAIN_STONE_FIELDS,
} from "./jobTrackerExport.js";

export const ORDER_QTY_EARRING = "1 Pcs";
export const ORDER_QTY_DEFAULT = "1 Pc";
const EARRING_PATTERN = /ear|stud|hoop|huggie|jhumk|dangl/i;

export function orderQtyFor(itemType) {
  return EARRING_PATTERN.test(String(itemType || "")) ? ORDER_QTY_EARRING : ORDER_QTY_DEFAULT;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2025-09-01" -> "01-Sep-2025" (the format printed on the PO). Anything
// that isn't an ISO date is returned untouched.
export function formatPoDate(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value || "").trim());
  if (!m) return value ? String(value) : "";
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${m[3].padStart(2, "0")}-${mon}-${m[1]}` : String(value);
}

// One printed line per stone row, e.g. "Round Black 8.2mm 2.71ct 1pc" or
// "Round 1.9mm 14pc". The carat weight is only shown for a single stone --
// for a multi-stone row it would be the total, which isn't what a
// "per stone" line reads as.
export function describePoStone(r, c) {
  const pcs = parseFloat(r.pcs) || 0;
  const shape = c.shape || r.customShape || "";
  const colour = (r.colour || "").trim();
  const size = cleanSize(c.size);
  const wt = pcs === 1 && c.totalWt ? `${c.totalWt.toFixed(2)}ct` : "";
  const count = pcs ? `${pcs}pc` : "";
  return [shape, colour, size, wt, count].filter(Boolean).join(" ");
}

function metalLabel(primaryAlloy, secondaryAlloy) {
  if (!primaryAlloy || !primaryAlloy.short) return "";
  const { metalType, metalColor, alloyType } = splitMetal(primaryAlloy);
  if (primaryAlloy.metal !== "AU") return primaryAlloy.short; // PT950 / AG925 / etc. read fine as-is
  const combined = resolveMetalColor(primaryAlloy, secondaryAlloy);
  const colour = combined && !String(combined).startsWith("RECHECK:") ? combined : metalColor;
  let alloy = alloyType;
  if (String(alloy).startsWith("RECHECK:")) alloy = "Nickel Free";
  return `${metalType} ${colour}`.trim() + (alloy ? ` (${alloy})` : "");
}

const uniqueJoined = (values) => [...new Set(values.filter(Boolean))].join(", ");

/**
 * quote: {
 *   jobInfo, primaryAlloy, secondaryAlloy, secondaryGramWt,
 *   rowsWithCalcs: [{ r, c }], manualFields, printDate
 * }
 */
export function mapQuoteToPo(quote) {
  const { jobInfo = {}, primaryAlloy, secondaryAlloy, secondaryGramWt, rowsWithCalcs = [], manualFields = {}, printDate } = quote;

  const secondaryUsed = secondaryAlloy && (parseFloat(secondaryGramWt) || 0) > 0 ? secondaryAlloy : null;
  const metalColorCode = resolveMetalColor(primaryAlloy, secondaryUsed);

  const stoneRows = rowsWithCalcs.filter(({ r }) => r.stoneTypeSel !== "Plain");
  const isPlain = stoneRows.length === 0 && rowsWithCalcs.some(({ r }) => r.stoneTypeSel === "Plain");

  let stoneType = "";
  let suppliedBy = "";
  const stoneLines = []; // [{ text, quality }]
  if (isPlain) {
    stoneType = PLAIN_STONE_FIELDS.StoneType;
  } else {
    stoneType = uniqueJoined(stoneRows.map(({ r }) => stoneTypeLabel(r)));
    suppliedBy = uniqueJoined(stoneRows.map(({ r }) => r.source));
    for (const { r, c } of stoneRows) {
      stoneLines.push({ text: describePoStone(r, c), quality: (r.proposedQuality || "").trim() });
    }
  }

  const stampLogo = (manualFields.stampLogo || "").trim();

  return {
    poNumber: (jobInfo.jobNo || "").trim(),
    orderQty: orderQtyFor(jobInfo.itemType),
    orderDate: formatPoDate(manualFields.poDate || printDate),
    dueDate: formatPoDate(manualFields.dueDate),
    customer: (jobInfo.customer || "").trim(),
    vendor: (manualFields.vendor || "").trim(),
    ourStyle: (jobInfo.itemNo || "").trim(),
    yourStyle: (manualFields.vendorItemNo || "").trim(),
    itemType: (jobInfo.itemType || "").trim(),
    itemSize: (jobInfo.itemSize || "").trim(),
    metal: metalLabel(primaryAlloy, secondaryUsed),
    metalColorCode: String(metalColorCode || "").startsWith("RECHECK:") ? "" : metalColorCode,
    rhodium: resolveRhodium(jobInfo, metalColorCode),
    findings: [manualFields.finding1, manualFields.finding2].map((v) => (v || "").trim()).filter(Boolean).join(", "),
    setBy: (manualFields.setBy || "").trim(),
    stoneType,
    suppliedBy,
    stoneLines,
    isPlain,
    stampLogo: stampLogo || "None",
    stampMetal: (manualFields.stampMetal || "").trim(),
    stampOther: (manualFields.stampOther || "").trim(),
    stampLoc: (manualFields.stampLoc || "").trim(),
    remarks: (jobInfo.remarks || "").trim(),
  };
}
