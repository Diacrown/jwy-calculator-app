import JSZip from "jszip";
// Main File bulk-export bridge (formerly "Job Tracker export" -- renamed
// to match the "Export to Main File" button, since this has always fed
// the same Main WS sheet).
//
// Converts ONE resolved JWY Calculator quote into a single Main File
// row, using your exact 35-column list, in order. Most of the sheet
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
// COLUMN LIST -- exact order, exact spelling, as given (35 columns).
// Columns for fields that aren't collected in the Calculator at all
// (Office Ship Date, QC pass Date, Ship Date, Delay, Saurabh Bhai) stay
// on this list -- the sheet has those columns, they just come through
// blank from this export.
//
// "Office Ship Date" appears TWICE on purpose (3rd and 11th column) --
// that's how the real Main File sheet is laid out. Because a duplicate
// header can't live in a plain {header: value} object, the sheet is
// written from an array-of-arrays (see jobTrackerRowToAoa below), not
// XLSX.utils.json_to_sheet, which would silently rename the second one
// to "Office Ship Date_1". Both copies are always blank.
// ============================================================
export const JOB_TRACKER_COLUMNS = [
  "SSP", "Approval Date", "Office Ship Date", "PODate", "DueDate", "Vendor", "VendorItemNo",
  "Saurabh Bhai", "Delay", "Stone Issue Date", "Office Ship Date", "QC pass Date", "Ship Date",
  "ItemType", "ItemSize", "Qty", "MetalType", "MetalColor", "AlloyType", "Rhodium", "StoneType",
  "StoneDetails", "StoneSource", "SettingType", "StampLogo", "StampMetal", "StampOther", "StampLoc",
  "Finding1", "Finding2", "Remarks", "Tag Color", "Image1", "Image2", "Image3",
];

function blankRow() {
  const row = {};
  for (const col of JOB_TRACKER_COLUMNS) row[col] = "";
  return row;
}

// Main File writes dates day-month-year with no zero padding, e.g.
// "8-8-2025". The date pickers in the Calculator hand over "2025-08-08",
// which is converted here; anything that isn't in that shape is left alone.
export function formatDmy(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || "").trim());
  return m ? `${Number(m[3])}-${Number(m[2])}-${m[1]}` : value;
}

// Main File text is Google Sans, size 8. SheetJS can't style cells, so after
// the workbook is written the default font in xl/styles.xml is swapped for
// that one (every cell uses the default style, so this covers the whole
// sheet, headers included).
export const MAIN_FILE_FONT = { name: "Google Sans", size: 8 };
export async function applyMainFileFont(xlsxBytes) {
  const zip = await JSZip.loadAsync(xlsxBytes);
  const stylesFile = zip.file("xl/styles.xml");
  if (!stylesFile) return xlsxBytes;
  let xml = await stylesFile.async("string");
  const font = `<font><sz val="${MAIN_FILE_FONT.size}"/><color rgb="FF000000"/><name val="${MAIN_FILE_FONT.name}"/><family val="2"/></font>`;
  const replaced = xml.replace(/(<fonts[^>]*>)\s*<font>[\s\S]*?<\/font>/, `$1${font}`);
  if (replaced === xml) return xlsxBytes; // unexpected layout -- leave the file untouched
  zip.file("xl/styles.xml", replaced);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// Header row + one data row, in exact JOB_TRACKER_COLUMNS order, for
// XLSX.utils.aoa_to_sheet. Safe with the duplicate "Office Ship Date"
// header (both copies read the same -- blank -- row value).
export function jobTrackerRowToAoa(row) {
  return [JOB_TRACKER_COLUMNS, JOB_TRACKER_COLUMNS.map((c) => (row[c] === undefined || row[c] === null ? "" : row[c]))];
}

// ============================================================
// METAL -- splits an alloy short name like "14KT YG" / "14KT WG-PD" /
// "PT950" / "AG925" into three columns, matching the exact vocabulary
// your real Main WS rows use (verified against real rows -- e.g.
// "14KT | YG | Standard" and "18KT | WG | Palladium"):
//   MetalType  -- "14KT" (karat, no color/variant suffix)
//   MetalColor -- the sheet's designated colour code, worked out from
//                 the PRIMARY and SECONDARY alloy together -- see
//                 resolveMetalColor() below (e.g. YG, WY, YR, YP, 950,
//                 925+18YG). MetalType / AlloyType below still describe
//                 the primary alloy only.
//   AlloyType  -- the white-gold casting variant: "Standard" (Nickel
//                 Safe -- the default) or "Palladium" (the "-PD" alloys).
//                 Only ever set for gold; Platinum/Silver/Wax/Brass have
//                 no such variant in the Calculator's alloy list, so
//                 it's left blank for those rather than guessed.
// ============================================================
const METAL_COLOR_CODES = ["WG", "YG", "RG"];
export function splitMetal(alloy) {
  if (!alloy) return { metalType: "", metalColor: "", alloyType: "" };
  const short = alloy.short || "";
  const colorCode = METAL_COLOR_CODES.find((c) => short.includes(c));
  const metalColor = colorCode || (short.includes("PT") ? "PT" : short.includes("AG") ? "AG" : "");
  let metalType = colorCode ? short.replace(colorCode, "").replace(/-NF|-PD/g, "").trim() : short;
  // Platinum is just "PT" in Main File -- the purity (950 etc.) is not part of MetalType.
  if (alloy.metal === "PT" || /^PT\d*$/i.test(short)) metalType = "PT";

  let alloyType = "";
  if (alloy.metal === "AU") {
    if (short.includes("-PD")) alloyType = "Palladium";
    else if (short.includes("-NF")) alloyType = "RECHECK:Nickel Free -- not yet confirmed against a real Main WS row (only Standard/Palladium seen so far)";
    else alloyType = "Standard";
  }
  return { metalType, metalColor, alloyType };
}

// ============================================================
// METAL COLOR -- the sheet's designated MetalColor codes:
//   one gold ........ WG / YG / RG
//   two golds ....... WY YW WR RW YR RY  (PRIMARY colour first, then
//                     SECONDARY -- e.g. primary Yellow + secondary Rose = "YR")
//   gold + platinum . YP / RP            (either order -- the sheet has no PY / PR)
//   platinum ........ 950                (PT950)
//   silver .......... 925                (AG925)
//   silver + gold ... 925+18YG           (AG925 with 18KT Yellow Gold, either order)
// Two golds of the SAME colour (e.g. 14KT YG + 18KT YG) collapse to the single
// code (YG). 22KT / 24KT gold carry no colour letter in their short name but
// are yellow gold, so they count as Y.
//
// Codes on the sheet's list that this CAN'T produce from two alloy slots:
//   YWR (three golds) and 925+SS (silver + stainless steel) -- there's no
//   third alloy slot / no steel alloy in the Calculator -- type those into
//   Main File by hand.
// Any combination NOT on the sheet's list (e.g. White Gold + Platinum,
// PT900, AG935) comes through flagged "RECHECK:..." rather than guessed, the
// same way the Nickel Free alloy type is.
//
// The secondary alloy only counts when one is actually chosen (not Wax) AND
// has a gram weight above 0 -- see mapQuoteToJobTrackerRow.
// ============================================================
function goldLetter(alloy) {
  if (!alloy || alloy.metal !== "AU") return "";
  const short = alloy.short || "";
  const code = ["WG", "YG", "RG"].find((c) => short.includes(c));
  if (code) return code[0];
  if (/^(22|24)KT$/i.test(short.trim())) return "Y";
  return "";
}

// null = nothing usable in this slot (empty / Wax)
function describeMetal(alloy) {
  if (!alloy || !alloy.short || alloy.metal === "WX") return null;
  const short = alloy.short.trim();
  if (alloy.metal === "AU") return { kind: "gold", letter: goldLetter(alloy), short };
  if (alloy.metal === "PT") return { kind: "pt", short };
  if (alloy.metal === "AG") return { kind: "ag", short };
  return { kind: "other", short };
}

const metalRecheck = (a, b) =>
  `RECHECK:No MetalColor code on the Main File list for ${[a, b].filter(Boolean).join(" + ")} -- type it in by hand`;

export function resolveMetalColor(primaryAlloy, secondaryAlloy) {
  const p = describeMetal(primaryAlloy);
  const s = describeMetal(secondaryAlloy);
  if (!p) return "";
  if (p.kind === "other" || (s && s.kind === "other")) return metalRecheck(p.short, s && s.short);

  if (!s) {
    if (p.kind === "gold") return p.letter ? `${p.letter}G` : metalRecheck(p.short);
    if (p.kind === "pt") return p.short === "PT950" ? "950" : metalRecheck(p.short);
    return p.short === "AG925" ? "925" : metalRecheck(p.short);
  }

  // two metals
  if (p.kind === "gold" && s.kind === "gold") {
    if (!p.letter || !s.letter) return metalRecheck(p.short, s.short);
    return p.letter === s.letter ? `${p.letter}G` : `${p.letter}${s.letter}`;
  }
  const [a, b] = [p, s].sort((x, y) => x.kind.localeCompare(y.kind)); // ag < gold < pt
  if (a.kind === "gold" && b.kind === "pt") {
    if (b.short === "PT950" && (a.letter === "Y" || a.letter === "R")) return `${a.letter}P`;
    return metalRecheck(p.short, s.short);
  }
  if (a.kind === "ag" && b.kind === "gold") {
    return a.short === "AG925" && b.short === "18KT YG" ? "925+18YG" : metalRecheck(p.short, s.short);
  }
  return metalRecheck(p.short, s.short);
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

export function resolveRhodium(jobInfo, metalColor) {
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

// ============================================================
// PLAIN ITEMS -- jewellery with no stones at all (just metal). A stone
// row whose Type is "Plain" marks the whole piece as plain. These are the
// values the stone columns take for such an item.
//
// PROVISIONAL: the Excel showing exactly what Main File expects for a
// plain item has not been received yet, so this is a best guess
// (StoneType "Plain", all other stone columns left empty). Once the
// sheet is available, change ONLY the values below -- nothing else needs
// touching.
// ============================================================
export const PLAIN_STONE_FIELDS = {
  StoneType: "Plain",
  StoneDetails: "",
  StoneSource: "",
  SettingType: "",
};
const isPlainRow = (r) => r && r.stoneTypeSel === "Plain";
export function stoneTypeLabel(r) {
  const raw = r.stoneTypeSel || (r.mode === "lgd" ? "Lab grown" : "Mined");
  return STONE_TYPE_SHEET_LABELS[raw] || raw;
}

// "2.1 mm (0.04 ct ±)" -> "2.1mm"; "6x4 mm" -> "6x4mm"; "6.90 x 4.30 x 1.60 mm" -> "6.90 x 4.30 x 1.60mm".
// Shared with the PO (poExport.js) so both print a stone's size the same way.
export function cleanSize(size) {
  if (!size || size === "manual entry" || size === "custom size") return "";
  return String(size).replace(/\s*\(.*?\)\s*/g, " ").replace(/\s*±\s*/g, " ").replace(/\s+mm\b/i, "mm").replace(/\s+/g, " ").trim();
}

// One line per stone row: Shape + Size + Proposed Quality + Pcs, e.g.
// "Round 1.9mm G/SI2 12 pcs" or "Tapered Baguette 6.90 x 4.30 x 1.60mm FG/VS2 2 pcs".
// A colour typed into the row's Colour box goes right after the shape
// ("Round Black 8.2mm ..."); anything left blank is simply skipped. Weight is
// not repeated here, and the internal pricing grade is never printed -- only the
// Proposed Quality the person chose. Rows are joined with "; " (see
// mapQuoteToJobTrackerRow).
export function describeStoneRow(r, c) {
  const shape = c.shape || r.customShape || "";
  const colour = (r.colour || "").trim();
  const size = cleanSize(c.size);
  const quality = (r.proposedQuality || "").trim();
  const n = parseFloat(r.pcs) || 0;
  const pcs = n > 0 ? `${Math.round(n * 1000) / 1000} pcs` : "";
  return [shape, colour, size, quality, pcs].filter(Boolean).join(" ");
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

// Main File wording for the stone Source: the CAD form's "HO" is written
// "Diacrown" here; "Customer" (or anything else typed) is passed through.
function mainFileSource(v) {
  const t = String(v || "").trim();
  return /^ho$/i.test(t) ? "Diacrown" : t;
}

// Setting type defaults to "Hand" when the CAD form gave none for a stone.
const DEFAULT_SETTING_TYPE = "Hand";
const mainFileSetting = (v) => String(v || "").trim() || DEFAULT_SETTING_TYPE;

// Product size as "<size> (<region>)", e.g. "M (UK)" or "7 (US)". The CAD form
// sends the size with its own region in front ("UK M", "US 7"); that region
// moves into the brackets after the size. A size with no region in front takes
// the Calculator's selected location without its "WS" prefix (WSUK -> UK).
const SIZE_REGIONS = "UK|US|EU|AU|IN|JP|CA|NZ|SG|AE|FR|DE|IT|CH|HK";
export function formatProductSize(itemSize, locationCode) {
  let size = String(itemSize || "").trim().replace(/\s+/g, " ");
  if (!size) return "";
  if (/\(\s*[A-Za-z]{2,4}\s*\)$/.test(size)) return size; // already "M (UK)"
  const m = size.match(new RegExp(`^(${SIZE_REGIONS})\\s+(\\S.*)$`, "i"));
  if (m) return `${m[2].trim()} (${m[1].toUpperCase()})`;
  const loc = String(locationCode || "").trim().toUpperCase().replace(/^WS(?=[A-Z]{2}$)/, "");
  return loc ? `${size} (${loc})` : size;
}

// ============================================================
// SSP -- the Calculator's own "With 5% duty · USD" total (totalWithDutyUSD,
// passed in as sspDefaultUsd), written in the JADELIGHTXZ price code, e.g.
// $1,610 -> "JIJX". Still overridable: whatever is typed into SSP in the Job
// Tracker details panel goes out exactly as typed.
//
// ASSUMED MAPPING (the real letter<->digit table has not been supplied; this is
// the one the Phoenix Calculator uses): the digits 1 2 3 4 5 6 7 8 9 0 are
// written J A D E L I G H T X, position by position. "Z" (the 11th letter of
// JADELIGHTXZ) is not used -- if it is a repeat marker or stands for something
// else, change SSP_CIPHER / encodeSsp below; nothing else needs touching.
export const SSP_CIPHER = { digits: "1234567890", letters: "JADELIGHTX" };
export function encodeSsp(amount) {
  const n = Math.round(Number(amount));
  if (!isFinite(n) || n <= 0) return "";
  return String(n)
    .split("")
    .map((d) => SSP_CIPHER.letters[SSP_CIPHER.digits.indexOf(d)] || d)
    .join("");
}
function resolveSsp(manualFields, sspDefaultUsd) {
  const typed = ((manualFields || {}).ssp || "").trim();
  if (typed) return typed;
  return encodeSsp(sspDefaultUsd);
}

// ============================================================
// MANUAL FIELDS -- everything on the 35-column list that the
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
// Office Ship Date (both copies), QC pass Date, Ship Date, Delay and
// Saurabh Bhai are not in this list -- their columns are in
// JOB_TRACKER_COLUMNS/the sheet, they just always come through blank
// from this export. SSP is also not in this list -- it's derived
// automatically (see resolveSsp above) instead of hand-typed.
// ============================================================
export const JOB_TRACKER_MANUAL_FIELDS = [
  { key: "approvalDate", label: "Approval Date", column: "Approval Date", group: "Workflow", type: "date" },
  { key: "poDate", label: "PO Date", column: "PODate", group: "Workflow", type: "date" },
  { key: "dueDate", label: "Due Date", column: "DueDate", group: "Workflow", type: "date" },
  { key: "stoneIssueDate", label: "Stone Issue Date", column: "Stone Issue Date", group: "Workflow", type: "date" },
  { key: "vendor", label: "Vendor", column: "Vendor", group: "Vendor", type: "select" },
  { key: "vendorItemNo", label: "Vendor Item No", column: "VendorItemNo", group: "Vendor", type: "text" },
  { key: "stampLogo", label: "Stamp Logo", column: "StampLogo", group: "Finishing", type: "select" },
  { key: "stampMetal", label: "Stamp Metal", column: "StampMetal", group: "Finishing", type: "select" },
  { key: "stampOther", label: "Stamp Other", column: "StampOther", group: "Finishing", type: "text" },
  { key: "stampLoc", label: "Stamp Location", column: "StampLoc", group: "Finishing", type: "select" },
  { key: "finding1", label: "Finding 1", column: "Finding1", group: "Finishing", type: "select" },
  { key: "finding2", label: "Finding 2", column: "Finding2", group: "Finishing", type: "select" },
  { key: "tagColor", label: "Tag Color", column: "Tag Color", group: "Finishing", type: "select" },
  // Printed on the Purchase Order only -- not a Main File column.
  { key: "setBy", label: "Set By (PO)", column: "", group: "Finishing", type: "select", poOnly: true },
];

// ============================================================
// DROPDOWN OPTIONS -- the "select" fields above. These are the real
// Main File lists as supplied (wording/typos kept exactly as given so
// what's exported matches the sheet's own values -- e.g. "Staming
// Instruction Will be given", "Tappered" style spellings). uniq() only
// trims stray leading/trailing spaces and drops exact repeats (the
// pasted lists had a few, e.g. "4+6'o Clock" twice) -- it never
// rewrites a value. Every dropdown also carries an "Other (type
// manually)" option so nobody's blocked by a value missing from a list.
// ============================================================
const uniq = (arr) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))];

// Stamp Logo -> logo image link. Picking one of the logos that has a
// link fills the Image3 column of the export with that link (see
// mapQuoteToJobTrackerRow / stampLogoUrl below). Logos with no link yet
// are just "" -- picking one still sets StampLogo, Image3 is left to
// whatever the job's own images put there.
const STAMP_LOGO_ENTRIES = [
  ["AKB", ""],
  ["ALS", ""],
  ["AMK", "https://drive.google.com/file/d/1IQfMsAPoHBcG3Y0PGs-9mm1DRrSH2nr1/view?usp=drive_link"],
  ["APS", ""],
  ["AS PER CAD", ""],
  ["BRAD", "https://drive.google.com/file/d/1USRwYrpPiiCLahI5XXOuZlbwKUnywTzc/view?usp=drive_link"],
  ["C&P Logo", ""],
  ["CHP LOGO", ""],
  ["DD", "https://drive.google.com/file/d/1mkLcOsqtfHw4Lmx7S1BBkg2obKV_Uygo/view?usp=drive_link"],
  ["Diamantra", "https://drive.google.com/file/d/1FBdRYa1UdrsX5xgwW7P1nvRt6cwENwy3/view?usp=drive_link"],
  ["GD", ""],
  ["JGY Logo", ""],
  ["JSO", "https://drive.google.com/file/d/1llo8glV5PA_A9HrRLqH1tD1LCjEWniyO/view?usp=drive_link"],
  ["LLF logo", ""],
  ["Lovells Logo", ""],
  ["LWS logo", ""],
  ["MGK", "https://drive.google.com/file/d/1wwS3KzbPMCam6iQEaOGMO9vOpKcjuJCt/view?usp=drive_link"],
  ["MJDS LOGO", ""],
  ["None", ""],
  ["OHG", ""],
  ["OHLIGUER Logo", ""],
  ["Other", ""],
  ["SaFa", ""],
  ["SHOF", "https://drive.google.com/file/d/1FDee4ELILhNGparD2ieZNln5RK8SC1Vs/view?usp=drive_link"],
  ["SRS", "https://drive.google.com/file/d/1bZ3i4T_lLBTnf09q-aEyO4x2z6PgdHFp/view?usp=drive_link"],
  ["World Shiner", "https://drive.google.com/file/d/18dg_OKdlGefDKAt5Jovvsqlf81KA7USz/view?usp=drive_link"],
  ["NMS", ""],
  ["VT", "https://drive.google.com/file/d/1Ryi2yLaYg0r6FSpwbcaX5Lw9EExX9pUB/view?usp=drive_link"],
  ["EFSG", "https://drive.google.com/file/d/1H0NuOWNQeFZSu8i8FphdyPpNqxo9RM0N/view?usp=drive_link"],
  ["LL", "https://drive.google.com/file/d/1PcQBn32EELhISiNJ6QlmSMS2DR2ePa4-/view?usp=drive_link"],
  ["Staming Instruction Will be given", ""],
  ["GRP Logo", "https://drive.google.com/open?id=1PmzF89Rk4h9QKZE8pAOiRrs7mDJOHPJp&usp=drive_fs"],
  ["Z17", "https://drive.google.com/file/d/1-_gB3exDRssiuDN1XP6Ijmr0mBihW-bs/view?usp=drive_link"],
];

export const STAMP_LOGO_URLS = Object.fromEntries(STAMP_LOGO_ENTRIES.filter(([, url]) => url));

// The link for a chosen Stamp Logo, or "" when that logo has none (or
// nothing's chosen / it's a free-typed "Other" value).
export function stampLogoUrl(name) {
  return STAMP_LOGO_URLS[(name || "").trim()] || "";
}

export const JOB_TRACKER_DROPDOWN_OPTIONS = {
  vendor: uniq([`Elegant`, `Swan`, `Arriva`, `Charisma`]),
  stampLogo: uniq(STAMP_LOGO_ENTRIES.map(([name]) => name)),
  stampMetal: uniq([
    `9K`, `10K`, `14K`, `18K`, `22K`, `PT`, `375`, `417`, `585`, `750`, `916`, `950`, `BRCZ`, `AGCZ`,
    `SS925`, `AY`, `AYCZ`, `PT950`, `9ct`, `18ct`, `14ct`, `SS925 LGD`, `925`,
    `Staming Instruction Will be given`,
  ]),
  stampLoc: uniq([
    `4'o Clock`, `4+8'o Clock`, `Basket+Back`, `Post+Back`, `Rearside`, `Innerside`, `Clasp`,
    `4'o clock + head`, `Off center`, `4+6'o Clock`, `Head`, `Lock`, `Innerside+Basket`,
    `4+6'o Clock`, `Rearside+Basket`, `Basket+Lobster`, `6'o Clock`, `Back`, `2 o' Clock`,
    `3 o'clock`, `Left Side`, `Right Side`, `Left+Right Side`, `8'o Clock`,
    `4'o clock + Center claw`, `2o'clock + 8'o clock + head`, `Backside`, `Basket`, `Head Bottom`,
    `4 o'clock+Head Bottom`, `4'o clock + Side claw`, `AS PER CAD`, `Bale+Basket`,
    `4+6+8' o Clock`, `Bale`, `4'o clock + Center Claw`, `Center Align Under Head`,
    `4'o clock + Center collet`, `4'o clock + Side collet`, `Staming Instruction Will be given`,
    `Center Align Under Head`, `4'o Clock Stamp Metal +3'o Clock Sr No and Logo at 9'o Clock`,
    `Metal Kt Rearside + One side logo in Basket and another side Sr No`,
    `Metal Kt on Bale + One side logo in Basket and another side Sr No`,
  ]),
  tagColor: uniq([`White`, `Red`, `Grey`]),
  setBy: uniq([`Hand`, `Machine`]),
};

// Finding 1 and Finding 2 share one list.
const FINDING_OPTIONS = uniq([
  `0.9*9.5mm Dbl Notch Post`, `4.0mm Disc Pshbk`, `5.0mm Disc Pshbk`, `6.0mm Disc Pshbk`,
  `7.0mm Disc Pshbk`, `8.0mm Disc Pshbk`, `9.0mm Disc Pshbk`, `Pshbk butterfly`,
  `18" w/ Jumpring at 16" & 14"`, `18" w/ Jumpring at 16"`, `16" w/ Jumpring at 14"`,
  `Hidden Clasp`, `Open Box Dbl8`, `Lobster Claw`, `Magnetic`, `Spring Ring`, `Single 8lock`,
  `US Cast`, `8.0mm Disc Screw Back`, `9.0mm Disc Screw Back`, `4.0mm Disc Screw Back`,
  `6.0mm Disc Screw Back`, `0.9*9.5mm Threaded Post`, `45cm w/ Jumpring at 42cm`,
  `5.5mm Disc Heart Shape Pshbk`, `Safety Chain`, `46cm with no extender`,
  `11.1x1.02x8.8thd Post x2.35pl`, `6.28x4.7x1.1x0.23thk 111-114`, `Leverback`,
  `19.3x6.5 mm Swivel Lobster Clasp`, `18in 030 RndCbl +9LC`, `43cm w/JumpRing at 41cm`,
  `45cm Chain`, `16" w/ Jumpring at 14" & 15"`, `55cm Curb Chain`, `7.0mm Disc Screw Back`,
  `18 inch chain`, `10mmx0.9mm Dbl Notch Post`, `10mm Disc Pshbk`, `50cm chain`, `40cm Chain`,
  `42cm Chain`, `55cm Chain`, `4.2mm Disc Heart Shape Pshbk`, `6.0mm Disc Heart Shape Pshbk`,
  `5.5mm Disc Heart Shape Pshbk`, `5.5mm Disc Pshbk`, `8.0mm Disc Heart Shape Pshbk`,
  `10.0mm Disc Heart Shape Pshbk`, `45cm w/jump ring at 40cm`, `20 w/jump ring at 18 inch`,
  `4.2mm Guardian Back`, `6mm Guardian Back`, `7mm Guardian Back`,
  `5.5mm Disc  Heart Shape Screw Back`, `8mm Disc Screw Back`, `15 inch `,
  `4.5mm Disc Heart Shape Pshbk`, `Fish Hook`, `6mm Disc Heart Shape Pshbk`,
  `10.00mm Disc Screw Back`, `8mm Disc Heart Shape Pshbk`, `50cm w/Jumpring at 45cm`,
  `6.5mm Disc Heart Shape Pshbk`, ` 4 mm Figaro Chain`, `4.2mm Disc Heart Shape Screw Back`,
  `17" w/ Jumpring at 15"`, `6.0mm Disc Heart Shape Screw Back`, `4.5mm Disc Heart Shape Screw Back`,
]);
JOB_TRACKER_DROPDOWN_OPTIONS.finding1 = FINDING_OPTIONS;
JOB_TRACKER_DROPDOWN_OPTIONS.finding2 = FINDING_OPTIONS;

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
  const { jobInfo, primaryAlloy, secondaryAlloy, secondaryGramWt, rowsWithCalcs, manualFields, sspDefaultUsd, locationCode } = quote;
  const row = blankRow();

  const { metalType, alloyType } = splitMetal(primaryAlloy);
  // Secondary alloy counts only when chosen and actually weighed in.
  const secondaryUsed = secondaryAlloy && (parseFloat(secondaryGramWt) || 0) > 0 ? secondaryAlloy : null;
  const metalColor = resolveMetalColor(primaryAlloy, secondaryUsed);
  // Plain rows are ignored whenever the quote also has real stones; a quote
  // that is Plain rows only is a metal-only item and takes PLAIN_STONE_FIELDS.
  const realStoneRows = rowsWithCalcs.filter(({ r }) => !isPlainRow(r));
  const isPlainItem = realStoneRows.length === 0 && rowsWithCalcs.some(({ r }) => isPlainRow(r));
  const stoneDetails = isPlainItem ? PLAIN_STONE_FIELDS.StoneDetails : realStoneRows.map(({ r, c }) => describeStoneRow(r, c)).join("; ");
  const stoneType = isPlainItem ? PLAIN_STONE_FIELDS.StoneType : uniqueJoined(realStoneRows.map(({ r }) => stoneTypeLabel(r)));
  const stoneSource = isPlainItem ? PLAIN_STONE_FIELDS.StoneSource : uniqueJoined(realStoneRows.map(({ r }) => mainFileSource(r.source)));
  const settingType = isPlainItem ? PLAIN_STONE_FIELDS.SettingType : uniqueJoined(realStoneRows.map(({ r }) => mainFileSetting(r.setting)));

  Object.assign(row, {
    SSP: resolveSsp(manualFields, sspDefaultUsd),
    ItemType: jobInfo.itemType || "",
    ItemSize: formatProductSize(jobInfo.itemSize, locationCode),
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
    if (f.poOnly) continue; // PO-only fields (e.g. Set By) have no Main File column
    const val = (manualFields || {})[f.key];
    if (val) row[f.column] = f.type === "date" ? formatDmy(val) : val;
  }

  // A Stamp Logo that has a link on file goes straight into Image3. This
  // wins over the job's own 3rd picture -- JwyCalculator.jsx's export
  // reserves the Image3 slot in that case (pickJobTrackerImages with
  // slotCount 2), so only the first two job images are uploaded.
  const logoUrl = stampLogoUrl((manualFields || {}).stampLogo);
  if (logoUrl) row.Image3 = logoUrl;

  return row;
}

export function mapQuotesToJobTrackerSheet(quotes) {
  return quotes.map(mapQuoteToJobTrackerRow);
}

export const JOB_TRACKER_PENDING_ITEMS = [
  "Office Ship Date (both columns), QC pass Date, Ship Date, Delay, Saurabh Bhai -- not collected in the Calculator at all; these columns always come through blank and are filled in Main File directly.",
  "Approval Date, PODate, DueDate, Stone Issue Date, Vendor, VendorItemNo, StampLogo, StampMetal, StampOther, StampLoc, Finding1, Finding2, Tag Color -- the Calculator has no source for any of these (production-workflow dates and finishing instructions that only exist once the job is in progress). They're fillable by hand in the \"Job Tracker details\" panel in the Calculator (see JOB_TRACKER_MANUAL_FIELDS) so they don't have to stay blank in the export -- but if nobody fills that panel in, they still come through blank here.",
  "SSP -- the Calculator\'s \"With 5% duty · USD\" total written in the JADELIGHTXZ code (digits 1234567890 -> JADELIGHTX, assumed from the Phoenix Calculator; Z unused). Check one known job against Main File before relying on it. Anything typed into SSP in the Job Tracker details panel overrides it and goes out as typed.",
  "Image3 -- holds the Stamp Logo link when the chosen logo has one (then only the first 2 job images are uploaded); logos with no link yet leave Image3 to the job's own 3rd image. Links are the Google Drive share links as supplied (not direct image URLs).",
  "StoneDetails -- one entry per stone row, written as Shape + Size + Proposed Quality + Pcs (plus the Colour box if it is filled in), rows separated by \"; \". Weights are not repeated there.",
  "StoneSource / SettingType -- come from the CAD Order Form import (its Source/Set fields per stone). Source \"HO\" is written as \"Diacrown\" (Customer stays Customer). A stone with no setting gets the default \"Hand\". A quote built by hand has no Source, so StoneSource is blank for those.",
  "Rhodium -- filled from the CAD Order Form's own Rhodium field when the quote was imported from one, or from the manual Rhodium dropdown in the Calculator if set there; otherwise falls back to an inferred default (WG -> Yes, YG/RG -> No) based on every real row seen so far -- double-check it on jobs that are an exception to that pattern",
  "MetalColor -- worked out from the primary + secondary alloy using the sheet's own codes (WG/YG/RG, WY YW WR RW YR RY, YP, RP, 950, 925, 925+18YG). YWR (three golds) and 925+SS (silver + steel) can't come from two alloy slots, and combos not on the list (e.g. White Gold + Platinum, PT900, AG935) come through flagged RECHECK: -- type those into Main File by hand.",
  "Plain items (Type = Plain, metal only) -- StoneType comes through as \"Plain\" and StoneDetails/StoneSource/SettingType are left empty. PROVISIONAL until the Main File sheet for plain items is checked; adjust PLAIN_STONE_FIELDS in jobTrackerExport.js.",
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

// slotCount defaults to all 3 image columns; pass 2 when Image3 is
// already taken by a Stamp Logo link.
// page1Image (optional) is the redrawn full page 1 of the CAD card (render +
// stone table); when there is one it takes the place of the first CAD render,
// so it is always Image1.
export function pickJobTrackerImages(cadImages, clientRefImages, slotCount = JOB_TRACKER_IMAGE_COLUMNS.length, page1Image = null) {
  const cad = page1Image ? [page1Image, ...(cadImages || []).slice(1)] : cadImages || [];
  return [...cad, ...(clientRefImages || [])].slice(0, slotCount);
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
