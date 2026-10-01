// Main File bulk-export bridge (formerly "Job Tracker export" -- renamed
// to match the "Export to Main File" button, since this has always fed
// the same Main WS sheet).
//
// Converts ONE resolved JWY Calculator quote into a single Main File
// row, using your exact 34-column list, in order. Most of the sheet
// still gets typed in by hand -- this export pre-fills only the columns
// the Calculator actually has a real answer for -- SSP, ItemType,
// ItemSize, Qty, MetalType/MetalColor/AlloyType, Rhodium,
// StoneType/StoneDetails/StoneSource, SettingType, and Remarks.
// StoneSource, SettingType and Rhodium specifically come from the CAD
// Order Form import (its Source/Set/Rhodium fields) when the quote was
// built from one -- see uniqueJoined()/resolveRhodium() below.
//
// Everything else on the list (approvals, PO/due dates, stamping,
// findings, tag color, images) is downstream production data that only
// exists once the job is physically moving through the shop floor --
// the Calculator has no source for it, so those columns are
// intentionally left blank for whoever runs Main File to fill in. See
// JOB_TRACKER_PENDING_ITEMS below for the full breakdown of what's left
// blank and why.

// ============================================================
// COLUMN LIST -- exact order, exact spelling, as given. Columns for
// fields removed from the manual-entry panel (QC Ready Date, QC pass
// Date, Ship Date, Delay, Saurabh Bhai) stay on this list -- the sheet
// still has those columns, they just come through blank from this
// export now instead of being hand-typed into the Calculator first.
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
// c.size now reflects a real typed value even for fully-custom
// shape+size rows (the Calculator used to hardcode "manual entry" here
// with no way to type an actual size -- fixed alongside this export).
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
// SSP -- pulled straight from the Calculator's own "(With 5% duty ·
// USD)" total (totalWithDutyUSD, passed in as sspDefaultUsd) rather
// than typed by hand. Still overridable: if the Job Tracker details
// panel has something typed into SSP, that wins.
//
// NOT YET DONE: the real Main File SSP column is expected to hold this
// number run through a "JADELIGHTXZ" price-code cipher (the common
// jewellery-retail trick of a 10ish-letter codeword standing in for
// digits, so a plain wholesale cost isn't sitting in the open on the
// sheet) rather than the raw USD figure. Nobody has given this
// function the actual letter<->digit mapping yet, so for now SSP comes
// through as the plain calculated number -- someone needs to
// hand-apply the cipher after export until the mapping is supplied and
// wired in here.
// ============================================================
function resolveSsp(manualFields, sspDefaultUsd) {
  const typed = ((manualFields || {}).ssp || "").trim();
  if (typed) return typed;
  if (typeof sspDefaultUsd === "number" && isFinite(sspDefaultUsd) && sspDefaultUsd > 0) {
    return String(sspDefaultUsd);
  }
  return "";
}

// ============================================================
// MANUAL FIELDS -- everything on the 34-column list that the
// Calculator has no source for at all (no quote data, no CAD Order
// Form field) -- production-workflow dates, vendor/finishing info that
// only exists once the job is physically moving. Single source of
// truth for both the UI panel (JobTrackerFieldsCard in
// JwyCalculator.jsx) and this row-mapping function, so a field added
// here shows up in the form and the export automatically.
//
// `type` drives how JobTrackerFieldsCard renders the field:
//   "text"   -- plain text input (default when omitted)
//   "date"   -- <input type="date">, calendar picker
//   "select" -- dropdown seeded from JOB_TRACKER_DROPDOWN_OPTIONS
//               below, with an "Other (type manually)" escape hatch
//
// QC Ready Date, QC pass Date, Ship Date, Delay and Saurabh Bhai were
// removed from this list on request -- their columns are still in
// JOB_TRACKER_COLUMNS/the sheet, they just always come through blank
// from this export now. SSP was also pulled out of this list -- it's
// derived automatically (see resolveSsp above) instead of hand-typed.
// ============================================================
export const JOB_TRACKER_MANUAL_FIELDS = [
  { key: "approvalDate", label: "Approval Date", column: "Approval Date", group: "Workflow", type: "date" },
  { key: "poDate", label: "PO Date", column: "PODate", group: "Workflow", type: "date" },
  { key: "dueDate", label: "Due Date", column: "DueDate", group: "Workflow", type: "date" },
  { key: "stoneIssueDate", label: "Stone Issue Date", column: "Stone Issue Date", group: "Workflow", type: "date" },
  { key: "vendor", label: "Vendor", column: "Vendor", group: "Vendor", type: "select" },
  { key: "vendorItemNo", label: "Vendor Item No", column: "VendorItemNo", group: "Vendor", type: "text" },
  { key: "stampLogo", label: "Stamp Logo", column: "StampLogo", group: "Finishing", type: "text" },
  { key: "stampMetal", label: "Stamp Metal", column: "StampMetal", group: "Finishing", type: "select" },
  { key: "stampOther", label: "Stamp Other", column: "StampOther", group: "Finishing", type: "text" },
  { key: "stampLoc", label: "Stamp Location", column: "StampLoc", group: "Finishing", type: "select" },
  { key: "finding1", label: "Finding 1", column: "Finding1", group: "Finishing", type: "select" },
  { key: "finding2", label: "Finding 2", column: "Finding2", group: "Finishing", type: "select" },
  { key: "tagColor", label: "Tag Color", column: "Tag Color", group: "Finishing", type: "select" },
];

// ============================================================
// DROPDOWN OPTIONS -- seed lists for the "select" fields above.
//
// PROVISIONAL: these were pulled from the only real Main WS rows this
// session could read (a 42-row slice via the Drive connector, all one
// Vendor) -- nowhere near the full, authoritative list of values the
// sheet actually uses (e.g. Vendor shows only "Elegant" here, which is
// obviously not the only vendor). Treat every list below as a
// starting point, not the real thing. Every dropdown also carries an
// "Other (type manually)" option so nobody's blocked by a missing
// value in the meantime. Replace these arrays with the real lists once
// they're confirmed, and the dropdowns pick them up automatically --
// no other code needs to change.
// ============================================================
export const JOB_TRACKER_DROPDOWN_OPTIONS = {
  vendor: ["Elegant"],
  stampMetal: ["750", "BRCZ"],
  stampLoc: ["4+8'o Clock", "Post+Back", "Rearside"],
  finding1: ["0.9*9.5mm Dbl Notch Post", '18" w/ Jumpring at 16" & 14"'],
  finding2: ["7.0mm Disc Pshbk", "8.0mm Disc Pshbk"],
  tagColor: ["Grey", "White"],
};

export const EMPTY_JOB_TRACKER_MANUAL_FIELDS = {
  ssp: "",
  ...Object.fromEntries(JOB_TRACKER_MANUAL_FIELDS.map((f) => [f.key, ""])),
};

/**
 * Converts one resolved quote into a single Main File row.
 * `sspDefaultUsd` is the Calculator's own totalWithDutyUSD ("With 5%
 * duty · USD") figure, used to auto-fill SSP when nothing's typed in.
 */
export function mapQuoteToJobTrackerRow(quote) {
  const { jobInfo, primaryAlloy, rowsWithCalcs, manualFields, sspDefaultUsd } = quote;
  const row = blankRow();

  const { metalType, metalColor, alloyType } = splitMetal(primaryAlloy);
  const stoneDetails = rowsWithCalcs.map(({ r, c }) => describeStoneRow(r, c)).join("; ");
  const stoneType = uniqueJoined(rowsWithCalcs.map(({ r }) => stoneTypeLabel(r)));
  const stoneSource = uniqueJoined(rowsWithCalcs.map(({ r }) => r.source));
  const settingType = uniqueJoined(rowsWithCalcs.map(({ r }) => r.setting));

  Object.assign(row, {
    SSP: resolveSsp(manualFields, sspDefaultUsd),
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
  // all -- applied last, straight from the person's own typed/selected
  // values. (SSP is handled above via resolveSsp, not here.)
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
  "QC Ready Date, QC pass Date, Ship Date, Delay, Saurabh Bhai -- no longer collected in the Calculator at all (removed from the manual-entry panel on request); these columns always come through blank now and are filled in Main File directly.",
  "Approval Date, PODate, DueDate, Stone Issue Date, Vendor, VendorItemNo, StampLogo, StampMetal, StampOther, StampLoc, Finding1, Finding2, Tag Color -- the Calculator has no source for any of these (production-workflow dates and finishing instructions that only exist once the job is in progress). They're fillable by hand in the \"Job Tracker details\" panel in the Calculator (see JOB_TRACKER_MANUAL_FIELDS) so they don't have to stay blank in the export -- but if nobody fills that panel in, they still come through blank here.",
  "SSP -- auto-filled from the Calculator's own \"With 5% duty · USD\" total unless overridden by hand, but NOT yet run through the JADELIGHTXZ price-code cipher the real Main File column is expected to use -- see the comment above resolveSsp() -- so it currently comes through as the plain USD number.",
  "Vendor / StampMetal / StampLoc / Finding1 / Finding2 / Tag Color dropdown options -- seeded from a small real-data sample only (see JOB_TRACKER_DROPDOWN_OPTIONS above), not the authoritative list -- confirm/replace once the real lists are available.",
  "StoneSource / SettingType -- only filled when the quote came from a CAD Order Form import (its Source/Set fields per stone); a quote built by hand in the Calculator has nowhere for these to come from, so they're blank for those",
  "Rhodium -- filled from the CAD Order Form's own Rhodium field when the quote was imported from one, or from the manual Rhodium dropdown in the Calculator if set there; otherwise falls back to an inferred default (WG -> Yes, YG/RG -> No) based on every real row seen so far -- double-check it on jobs that are an exception to that pattern",
  "AlloyType 'Nickel Free' (the -NF alloys) -- not yet confirmed against a real Main WS row (only Standard/Palladium have been seen), so it's flagged with RECHECK: rather than guessed",
];

// ============================================================
// IMAGES -- Image1/Image2/Image3 hold a hosted URL for each picture
// (not an embedded binary and not a bare filename), pulled from
// whatever the Calculator already has uploaded for this job: CAD
// renders first (the primary shop-floor reference), then client
// reference images to fill any slots CAD didn't use. Only the first 3
// across both groups are used -- there are only 3 image columns. The
// actual upload-and-get-a-URL step happens in JwyCalculator.jsx
// (doExportJobTracker), against the new job-tracker-image Netlify
// function -- this file only picks which images go in which slot and
// reads off their file extension.
// ============================================================
export const JOB_TRACKER_IMAGE_COLUMNS = ["Image1", "Image2", "Image3"];

export function pickJobTrackerImages(cadImages, clientRefImages) {
  return [...(cadImages || []), ...(clientRefImages || [])].slice(0, JOB_TRACKER_IMAGE_COLUMNS.length);
}

// Data URLs coming out of the Calculator are always
// "data:image/<jpeg|png>;base64,...." (see compressDataUrl /
// fileToDataUrl in JwyCalculator.jsx) -- this pulls out the
// extension the image-hosting upload needs.
export function dataUrlImageExtension(dataUrl) {
  const match = /^data:image\/(png|jpe?g)/i.exec(dataUrl || "");
  if (!match) return null;
  return match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
}
