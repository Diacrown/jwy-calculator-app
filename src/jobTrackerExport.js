// Job Tracker bulk-export bridge.
//
// Converts ONE resolved JWY Calculator quote into a single Job Tracker
// row, using your exact 34-column list, in order. Job Tracker
// currently gets its data typed in by hand, so this export pre-fills
// only the columns the Calculator actually has a real answer for --
// ItemType, ItemSize, Qty, MetalType/MetalColor/AlloyType, Rhodium,
// StoneType/StoneDetails/StoneSource, SettingType, and Remarks.
// StoneSource, SettingType and Rhodium specifically come from the CAD
// Order Form import (its Source/Set/Rhodium fields) when the quote was
// built from one -- see uniqueJoined()/resolveRhodium() below.
//
// Everything else on the list (approvals, PO/due dates, QC and ship
// dates, the assigned person, stamping, findings, tag color, images)
// is downstream production data that only exists once the job is
// physically moving through the shop floor -- the Calculator has no
// source for it, so those columns are intentionally left blank for
// whoever runs Job Tracker to fill in. See JOB_TRACKER_PENDING_ITEMS
// below for the full breakdown of what's left blank and why.

// ============================================================
// COLUMN LIST -- exact order, exact spelling, as given.
// ============================================================
export const JOB_TRACKER_COLUMNS = [
  "SSP", "Approval Date", "PODate", "DueDate", "Vendor", "VendorItemNo", "Saurabh Bhai", "Delay",
  "Stone Issue Date", "QC Ready Date", "QC pass Date", "Ship Date", "ItemType", "ItemSize", "Qty",
  "MetalType", "MetalColor", "AlloyType", "Rhodium", "StoneType", "StoneDetails", "StoneSource",
  "SettingType", "StampLogo", "StampMetal", "StampOther", "StampLoc", "Finding1", "Finding2",
  "Remarks", "Tag Color", "Image1", "Image2", "Image3",
];

function blankRow() {
  const row = {};
  for (const col of JOB_TRACKER_COLUMNS) row[col] = "";
  return row;
}

// ============================================================
// METAL -- splits an alloy short name like "14KT YG" / "14KT WG-PD" /
// "PT950" / "AG925" into three columns, matching the exact vocabulary
// your real Main WS rows use (verified against real rows -- e.g.
// "14KT | YG | Standard" and "18KT | WG | Palladium"):
//   MetalType  -- "14KT" (karat, no color/variant suffix)
//   MetalColor -- "WG" / "YG" / "RG" / "PT" / "AG" (short code, not
//                 a full name -- the sheet uses codes, not "White Gold")
//   AlloyType  -- the white-gold casting variant: "Standard" (Nickel
//                 Safe -- the default) or "Palladium" (the "-PD" alloys).
//                 Only ever set for gold; Platinum/Silver/Wax/Brass have
//                 no such variant in the Calculator's alloy list, so
//                 it's left blank for those rather than guessed.
// ============================================================
const METAL_COLOR_CODES = ["WG", "YG", "RG"];
function splitMetal(alloy) {
  if (!alloy) return { metalType: "", metalColor: "", alloyType: "" };
  const short = alloy.short || "";
  const colorCode = METAL_COLOR_CODES.find((c) => short.includes(c));
  const metalColor = colorCode || (short.includes("PT") ? "PT" : short.includes("AG") ? "AG" : "");
  const metalType = colorCode ? short.replace(colorCode, "").replace(/-NF|-PD/g, "").trim() : short;

  let alloyType = "";
  if (alloy.metal === "AU") {
    if (short.includes("-PD")) alloyType = "Palladium";
    else if (short.includes("-NF")) alloyType = "RECHECK:Nickel Free -- not yet confirmed against a real Main WS row (only Standard/Palladium seen so far)";
    else alloyType = "Standard";
  }
  return { metalType, metalColor, alloyType };
}

// ============================================================
// RHODIUM -- the CAD Order Form already asks this directly ("Rhodium:
// Yes/No/N/A" on the card) and the Calculator carries it through on
// import as jobInfo.rhodium, so that's used whenever it's present.
// Only falls back to the WG/YG-based guess below when a job was never
// imported from a CAD Order Form (e.g. built by hand in the
// Calculator), since every real Main WS row with MetalColor "WG" has
// Rhodium "Yes" and every "YG"/"RG" row has "No".
// ============================================================
function inferRhodium(metalColor) {
  if (metalColor === "WG") return "Yes";
  if (metalColor === "YG" || metalColor === "RG") return "No";
  return ""; // Platinum/Silver/unknown -- no confirmed pattern in real rows, left blank
}

function resolveRhodium(jobInfo, metalColor) {
  const fromCad = (jobInfo.rhodium || "").trim();
  return fromCad || inferRhodium(metalColor);
}

// ============================================================
// STONE TYPE -- the Calculator's own stoneTypeSel vocabulary (Mined,
// CZ, Mount, Zircon, Sapphire, ...) already matches Main WS's StoneType
// column almost exactly -- the one mismatch is "Lab grown" vs the
// sheet's "LGD" abbreviation (confirmed on a real row), remapped here.
// ============================================================
const STONE_TYPE_SHEET_LABELS = { "Lab grown": "LGD" };
function stoneTypeLabel(r) {
  const raw = r.stoneTypeSel || (r.mode === "lgd" ? "Lab grown" : "Mined");
  return STONE_TYPE_SHEET_LABELS[raw] || raw;
}

// One line per stone row, e.g. "Round 3.5mm 5pcs 0.25cttw TW SI1",
// matching the shape/size/pcs/cttw pattern real StoneDetails rows use
// (e.g. "RD 1.4mm 21pcs 0.25 cttw") -- no per-row source tag, since
// StoneType already carries Mined/LGD/Mount/etc. for the whole quote.
function describeStoneRow(r, c) {
  const shape = c.shape || r.customShape || "";
  const size = c.size && c.size !== "manual entry" ? c.size : "";
  const pcsLabel = r.pcs ? `${r.pcs}pcs` : "";
  const wtLabel = c.totalWt ? `${c.totalWt.toFixed(2)}cttw` : "";
  const qualityOrGrade = r.mode === "lgd" ? [r.lgdShape, r.lgdGrade].filter(Boolean).join(" ") : r.quality;
  return [shape, size, pcsLabel, wtLabel, qualityOrGrade].filter(Boolean).join(" ");
}

// ============================================================
// STONE SOURCE & SETTING -- both come straight off the CAD Order Form
// (per-stone "Source" and "Set" fields, e.g. Source: "HO"/"Customer"/
// "Diacrown", Set: "Prong"/"Micro pave"/"French pave") and the
// Calculator now carries them through per stone row on import. A quote
// built by hand (no CAD Order Form import) simply won't have these on
// its rows, so this comes back blank the same as any other
// never-typed-in field -- there's nothing to derive it from.
// ============================================================
function uniqueJoined(values) {
  return [...new Set(values.filter(Boolean))].join(", ");
}

// ============================================================
// MANUAL FIELDS -- everything on the 34-column list that the
// Calculator has no source for at all (no quote data, no CAD Order
// Form field) -- production-workflow dates/people and finishing
// instructions that only exist once the job is physically moving.
// Single source of truth for both the UI panel (JobTrackerFieldsCard
// in JwyCalculator.jsx) and this row-mapping function, so a field
// added here shows up in the form and the export automatically.
// ============================================================
export const JOB_TRACKER_MANUAL_FIELDS = [
  { key: "ssp", label: "SSP", column: "SSP", group: "Workflow" },
  { key: "approvalDate", label: "Approval Date", column: "Approval Date", group: "Workflow" },
  { key: "poDate", label: "PO Date", column: "PODate", group: "Workflow" },
  { key: "dueDate", label: "Due Date", column: "DueDate", group: "Workflow" },
  { key: "stoneIssueDate", label: "Stone Issue Date", column: "Stone Issue Date", group: "Workflow" },
  { key: "qcReadyDate", label: "QC Ready Date", column: "QC Ready Date", group: "Workflow" },
  { key: "qcPassDate", label: "QC Pass Date", column: "QC pass Date", group: "Workflow" },
  { key: "shipDate", label: "Ship Date", column: "Ship Date", group: "Workflow" },
  { key: "delay", label: "Delay", column: "Delay", group: "Workflow" },
  { key: "vendor", label: "Vendor", column: "Vendor", group: "Vendor" },
  { key: "vendorItemNo", label: "Vendor Item No", column: "VendorItemNo", group: "Vendor" },
  { key: "saurabhBhai", label: "Saurabh Bhai", column: "Saurabh Bhai", group: "Vendor" },
  { key: "stampLogo", label: "Stamp Logo", column: "StampLogo", group: "Finishing" },
  { key: "stampMetal", label: "Stamp Metal", column: "StampMetal", group: "Finishing" },
  { key: "stampOther", label: "Stamp Other", column: "StampOther", group: "Finishing" },
  { key: "stampLoc", label: "Stamp Location", column: "StampLoc", group: "Finishing" },
  { key: "finding1", label: "Finding 1", column: "Finding1", group: "Finishing" },
  { key: "finding2", label: "Finding 2", column: "Finding2", group: "Finishing" },
  { key: "tagColor", label: "Tag Color", column: "Tag Color", group: "Finishing" },
];

export const EMPTY_JOB_TRACKER_MANUAL_FIELDS = Object.fromEntries(
  JOB_TRACKER_MANUAL_FIELDS.map((f) => [f.key, ""])
);

/**
 * Converts one resolved quote into a single Job Tracker row.
 */
export function mapQuoteToJobTrackerRow(quote) {
  const { jobInfo, primaryAlloy, rowsWithCalcs, manualFields } = quote;
  const row = blankRow();

  const { metalType, metalColor, alloyType } = splitMetal(primaryAlloy);
  const stoneDetails = rowsWithCalcs.map(({ r, c }) => describeStoneRow(r, c)).join("; ");
  const stoneType = uniqueJoined(rowsWithCalcs.map(({ r }) => stoneTypeLabel(r)));
  const stoneSource = uniqueJoined(rowsWithCalcs.map(({ r }) => r.source));
  const settingType = uniqueJoined(rowsWithCalcs.map(({ r }) => r.setting));

  Object.assign(row, {
    ItemType: jobInfo.itemType || "",
    ItemSize: jobInfo.itemSize || "",
    Qty: 1,
    MetalType: metalType,
    MetalColor: metalColor,
    AlloyType: alloyType,
    Rhodium: resolveRhodium(jobInfo, metalColor),
    StoneType: stoneType,
    StoneDetails: stoneDetails,
    StoneSource: stoneSource,
    SettingType: settingType,
    Remarks: jobInfo.remarks || "",
  });

  // Manual fields fill in whatever the Calculator has no source for at
  // all -- applied last, straight from the person's own typed values.
  for (const f of JOB_TRACKER_MANUAL_FIELDS) {
    const val = (manualFields || {})[f.key];
    if (val) row[f.column] = val;
  }

  return row;
}

export function mapQuotesToJobTrackerSheet(quotes) {
  return quotes.map(mapQuoteToJobTrackerRow);
}

export const JOB_TRACKER_PENDING_ITEMS = [
  "SSP, Approval Date, PODate, DueDate, Vendor, VendorItemNo, Saurabh Bhai, Delay, Stone Issue Date, QC Ready Date, QC pass Date, Ship Date, StampLogo, StampMetal, StampOther, StampLoc, Finding1, Finding2, Tag Color -- the Calculator has no source for any of these (production-workflow dates/people and finishing instructions that only exist once the job is in progress). They're fillable by hand in the \"Job Tracker details\" panel in the Calculator (see JOB_TRACKER_MANUAL_FIELDS) so they don't have to stay blank in the export -- but if nobody fills that panel in, they still come through blank here.",
  "StoneSource / SettingType -- only filled when the quote came from a CAD Order Form import (its Source/Set fields per stone); a quote built by hand in the Calculator has nowhere for these to come from, so they're blank for those",
  "Rhodium -- filled from the CAD Order Form's own Rhodium field when the quote was imported from one, or from the manual Rhodium dropdown in the Calculator if set there; otherwise falls back to an inferred default (WG -> Yes, YG/RG -> No) based on every real row seen so far -- double-check it on jobs that are an exception to that pattern",
  "AlloyType 'Nickel Free' (the -NF alloys) -- not yet confirmed against a real Main WS row (only Standard/Palladium have been seen), so it's flagged with RECHECK: rather than guessed",
];

// ============================================================
// IMAGES -- Image1/Image2/Image3 are filled with actual embedded
// pictures (not links or filenames), pulled from whatever the
// Calculator already has uploaded for this job: CAD renders first
// (the primary shop-floor reference), then client reference images
// to fill any slots CAD didn't use. Only the first 3 across both
// groups are embedded -- there are only 3 image columns.
// ============================================================
export const JOB_TRACKER_IMAGE_COLUMNS = ["Image1", "Image2", "Image3"];

export function pickJobTrackerImages(cadImages, clientRefImages) {
  return [...(cadImages || []), ...(clientRefImages || [])].slice(0, JOB_TRACKER_IMAGE_COLUMNS.length);
}

// Data URLs coming out of the Calculator are always
// "data:image/<jpeg|png>;base64,...." (see compressDataUrl /
// fileToDataUrl in JwyCalculator.jsx) -- this pulls out the
// extension ExcelJS needs to embed it.
export function dataUrlImageExtension(dataUrl) {
  const match = /^data:image\/(png|jpe?g)/i.exec(dataUrl || "");
  if (!match) return null;
  return match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
}
