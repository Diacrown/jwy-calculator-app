// Stone Schedule export -- the order-stage download.
//
// When a job reaches the order stage, someone opens the Calculator's
// Stone schedule section and downloads this sheet: one Excel line per
// stone row, everything the Calculator already knows about that line
// (shape, size, quality grade, weights, pcs, source, setting) plus two
// extra dropdown columns captured per line:
//   Item Type -- SS / PP
//   Lab       -- GIA / HRD / IGI / AGL / Non-Cert
// Both are also dropdowns inside the downloaded Excel itself (real
// Excel data validation), so lines can still be changed or filled in
// there after download.
//
// Prices ($/ct, totals, setting cost) are deliberately NOT in this
// sheet -- it's an ordering/procurement document, not a quote.
//
// Color / Clarity / Cut / Pol / Sym columns are present but blank: the
// Calculator only ever carries a combined price grade per line (e.g.
// "TW SI1"), never those attributes separately, so there's nothing
// correct to pre-fill them with. They're left for whoever places the
// order to fill in. The combined grade goes in "Quality Grade".

import JSZip from "jszip";

// Edit these two lists to change the dropdown choices -- both the
// in-app per-line dropdowns and the Excel dropdowns read from here.
export const STONE_ITEM_TYPES = ["SS", "PP"];
export const STONE_LABS = ["GIA", "HRD", "IGI", "AGL", "Non-Cert"];

export const STONE_SCHEDULE_COLUMNS = [
  "Job No", "Item No", "Style Code", "Pos", "Item Type", "Stone Type", "Shape", "Size", "Size Code",
  "Quality Grade", "Color", "Clarity", "Cut", "Pol", "Sym", "Lab", "Wt/pc (ct)", "Pcs", "Total Wt (ct)",
  "Source", "Setting",
];

// Columns that get an Excel dropdown, and the list each one uses.
const DROPDOWN_COLUMNS = { "Item Type": STONE_ITEM_TYPES, Lab: STONE_LABS };

// How many rows down the Excel dropdowns are applied (header is row 1),
// so lines added by hand after download still get the dropdown.
const DROPDOWN_LAST_ROW = 200;

const STONE_TYPE_SHEET_LABELS = { "Lab grown": "LGD" };

export function qualityGrade(r) {
  const type = r.stoneTypeSel || (r.mode === "lgd" ? "Lab grown" : "Mined");
  if (type !== "Mined" && type !== "Lab grown") return ""; // CZ/Mount/etc. -- priced by hand, no grade
  return r.mode === "lgd" ? [r.lgdShape, r.lgdGrade].filter(Boolean).join(" ") : r.quality || "";
}

const round3 = (n) => (isFinite(n) ? Number(Number(n).toFixed(3)) : "");

// lines: [{ pos, r, c, code }] -- r is the stone row, c its calculated
// values (shape/size/wtPerPc/totalWt), code the catalog size code ("" for
// custom rows), pos the row's position number in the Stone schedule grid.
export function buildStoneScheduleAoa(jobInfo, lines) {
  const ji = jobInfo || {};
  const body = lines.map(({ pos, r, c, code }) => {
    const stoneType = r.stoneTypeSel || (r.mode === "lgd" ? "Lab grown" : "Mined");
    return [
      ji.jobNo || "",
      ji.itemNo || "",
      ji.styleCode || "",
      pos,
      r.itemType || "",
      STONE_TYPE_SHEET_LABELS[stoneType] || stoneType,
      c.shape || r.customShape || "",
      c.size && c.size !== "manual entry" ? c.size : "",
      code || "",
      qualityGrade(r),
      "", "", "", "", "", // Color, Clarity, Cut, Pol, Sym -- see header comment
      r.lab || "",
      round3(c.wtPerPc),
      parseFloat(r.pcs) || 0,
      round3(c.totalWt),
      r.source || "",
      r.setting || "",
    ];
  });
  return [STONE_SCHEDULE_COLUMNS, ...body];
}

function colLetter(idx) {
  // Only ever < 26 columns here, but handle the general case anyway.
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// SheetJS's free build can't write Excel dropdowns (data validation),
// so they're added by editing the finished .xlsx (a zip) directly: a
// <dataValidations> block goes into the sheet XML at the position the
// spec requires (after sheetData/autoFilter/mergeCells, before
// pageMargins). jszip is already an app dependency.
async function addDropdownValidations(xlsxBytes) {
  const zip = await JSZip.loadAsync(xlsxBytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const file = zip.file(sheetPath);
  if (!file) throw new Error("Couldn't find the worksheet inside the generated Excel file.");
  let xml = await file.async("string");

  const items = Object.entries(DROPDOWN_COLUMNS).map(([colName, list]) => {
    const idx = STONE_SCHEDULE_COLUMNS.indexOf(colName);
    const L = colLetter(idx);
    return (
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
      `errorTitle="Not in list" error="Pick a value from the dropdown list." ` +
      `sqref="${L}2:${L}${DROPDOWN_LAST_ROW}"><formula1>"${xmlEscape(list.join(","))}"</formula1></dataValidation>`
    );
  });
  const block = `<dataValidations count="${items.length}">${items.join("")}</dataValidations>`;

  if (xml.includes("<pageMargins")) xml = xml.replace("<pageMargins", `${block}<pageMargins`);
  else xml = xml.replace("</worksheet>", `${block}</worksheet>`);

  zip.file(sheetPath, xml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// Builds the finished .xlsx and returns it as a Blob.
export async function buildStoneScheduleXlsx(XLSX, jobInfo, lines) {
  const ws = XLSX.utils.aoa_to_sheet(buildStoneScheduleAoa(jobInfo, lines));
  ws["!cols"] = STONE_SCHEDULE_COLUMNS.map((name) => ({
    wch: Math.max(name.length + 2, name === "Shape" || name === "Size" || name === "Setting" || name === "Source" ? 18 : 10),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stone Schedule");
  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const withDropdowns = await addDropdownValidations(raw);
  return new Blob([withDropdowns], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
