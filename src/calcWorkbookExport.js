// Calculation-check workbook ("Download calculation sheet").
//
// Builds an Excel file that lays out EVERY number behind the current
// quote, split by what it's used for, with live formulas that follow the
// Calculator's own pricing logic step by step -- so a person can check
// that everything was calculated correctly, and if something looks
// wrong, change a yellow input cell and watch the totals recalculate.
//
//   ReadMe   -- legend, sheet guide, data-source notes
//   Summary  -- the answer: App value vs Excel recalculation, per component
//   Metal    -- casting: alloy, purity, rates, min-gram rule, cost
//   Stones   -- every stone line: weights, $/ct, diamond $, setting $
//   Charges  -- labor, CAD fee, additional charge
//   Pricing  -- gross -> duty -> FX -> local price -> manual override
//   Rates    -- the lookup tables the formulas read (metal, alloys,
//               currency, locations, CAD, labor, setting tiers)
//
// Colour code (also written on the ReadMe sheet):
//   yellow cell, blue text -- input: safe to overwrite
//   white cell             -- formula: don't overwrite
//   grey cell              -- fixed text/number exactly as the app had it
//
// $/ct per stone line is an INPUT here (taken from whichever price grid
// the app used, with the source named in "Rate basis") rather than being
// re-derived -- the price grids themselves live in the Google Sheet, not
// in this file. Everything downstream of $/ct is a formula.
//
// Every formula cell is also written with its computed value cached, so
// the numbers show even in viewers that don't recalculate (e.g. Excel's
// Protected View). Excel recalculates everything on open regardless.

const r2 = (x) => Math.round(x * 100) / 100;
const ceil5 = (n) => (isFinite(n) ? Math.ceil(n / 5) * 5 : 0);

const NAVY = "FF1F3A5F";
const FONT = "Calibri";
const FILL = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const THIN = { style: "thin", color: { argb: "FFC9CFD6" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const FMT = {
  usd: '"$"#,##0.00',
  usd0: '"$"#,##0',
  num2: "#,##0.00",
  wt3: "0.000",
  pct: "0.0%",
  int: "#,##0",
  rate4: "0.0000",
};

const KIND = {
  input: { fill: FILL("FFFFF4CC"), font: { name: FONT, size: 10, color: { argb: "FF0B3D91" } } },
  calc: { fill: FILL("FFFFFFFF"), font: { name: FONT, size: 10, color: { argb: "FF111827" } } },
  fixed: { fill: FILL("FFF1F3F5"), font: { name: FONT, size: 10, color: { argb: "FF374151" } } },
};

function put(ws, addr, kind, value, fmt, opts = {}) {
  const cell = ws.getCell(addr);
  cell.value = value;
  const k = KIND[kind];
  cell.fill = k.fill;
  cell.font = { ...k.font, ...(opts.bold ? { bold: true } : {}) };
  cell.border = BORDER;
  if (fmt) cell.numFmt = fmt;
  const isTextResult = typeof value === "string" || (value && value.formula && typeof value.result === "string");
  cell.alignment = { vertical: "middle", horizontal: opts.align || (isTextResult || value == null ? "left" : "right"), wrapText: !!opts.wrap };
  return cell;
}
// A formula cell with its cached result.
const fx = (formula, result) => ({ formula, result });

function label(ws, addr, text, opts = {}) {
  const c = ws.getCell(addr);
  c.value = text;
  c.font = { name: FONT, size: 10, bold: !!opts.bold, color: { argb: opts.muted ? "FF6B7280" : "FF111827" }, italic: !!opts.italic };
  c.alignment = { vertical: "middle", wrapText: !!opts.wrap };
  return c;
}
function title(ws, text, sub) {
  const c = ws.getCell("A1");
  c.value = text;
  c.font = { name: FONT, size: 15, bold: true, color: { argb: NAVY } };
  if (sub) {
    const s = ws.getCell("A2");
    s.value = sub;
    s.font = { name: FONT, size: 10, italic: true, color: { argb: "FF6B7280" } };
  }
  ws.getRow(1).height = 24;
}
function headRow(ws, rowNum, labels, startCol = 1) {
  labels.forEach((t, i) => {
    const c = ws.getCell(rowNum, startCol + i);
    c.value = t;
    c.fill = FILL(NAVY);
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = BORDER;
  });
  ws.getRow(rowNum).height = 32;
}
function section(ws, rowNum, text, span = 5) {
  for (let i = 1; i <= span; i++) ws.getCell(rowNum, i).fill = FILL("FFE6EDF7");
  const c = ws.getCell(rowNum, 1);
  c.value = text;
  c.font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
  ws.getRow(rowNum).height = 20;
}
function widths(ws, arr) {
  arr.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}
function pageSetup(ws, landscape = true) {
  ws.pageSetup = { orientation: landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.views = [{ showGridLines: false, ...(ws.views && ws.views[0] ? ws.views[0] : {}) }];
}

// ---------------------------------------------------------------------
export async function buildCalcWorkbook(ExcelJS, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JWY Calculator";
  wb.created = d.exportedAt || new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const wsRead = wb.addWorksheet("ReadMe", { properties: { tabColor: { argb: "FF6B7280" } } });
  const wsSum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: NAVY } } });
  const wsMetal = wb.addWorksheet("Metal", { properties: { tabColor: { argb: "FFB8860B" } } });
  const wsStone = wb.addWorksheet("Stones", { properties: { tabColor: { argb: "FF2E7D6B" } } });
  const wsChg = wb.addWorksheet("Charges", { properties: { tabColor: { argb: "FF7B5EA7" } } });
  const wsPrice = wb.addWorksheet("Pricing", { properties: { tabColor: { argb: "FFC2410C" } } });
  const wsRates = wb.addWorksheet("Rates", { properties: { tabColor: { argb: "FF9CA3AF" } } });

  // =====================================================================
  // RATES -- lookup tables. Built first so other sheets can point at them.
  // =====================================================================
  title(wsRates, "Rates & lookup tables", "Snapshot of the tables the Calculator used for this quote. Yellow cells can be changed; formulas elsewhere read from here.");
  widths(wsRates, [16, 34, 16, 14, 16, 16, 14, 10]);
  let rr = 4;

  // --- Metal rates
  section(wsRates, rr++, "Metal rates", 8);
  headRow(wsRates, rr++, ["Metal code", "Label", "PM rate ($/oz)", "Wastage factor", "Base net $/gm"]);
  const metalCodes = Object.keys(d.metalRates || {});
  const mStart = rr;
  const baseByCode = {};
  metalCodes.forEach((code) => {
    const m = d.metalRates[code];
    const waste = m.wastage ?? 1;
    const base = r2((m.pmRateOz / 31.1035) * waste);
    baseByCode[code] = base;
    put(wsRates, `A${rr}`, "fixed", code);
    put(wsRates, `B${rr}`, "fixed", m.label || code);
    put(wsRates, `C${rr}`, "input", m.pmRateOz, FMT.num2);
    put(wsRates, `D${rr}`, "input", waste, FMT.rate4);
    put(wsRates, `E${rr}`, "calc", fx(`ROUND(C${rr}/31.1035*D${rr},2)`, base), FMT.num2);
    rr++;
  });
  const mEnd = Math.max(rr - 1, mStart);
  const R_METAL_CODE = `Rates!$A$${mStart}:$A$${mEnd}`;
  const R_METAL_BASE = `Rates!$E$${mStart}:$E$${mEnd}`;
  label(wsRates, `A${rr}`, "Base net $/gm = PM rate per oz ÷ 31.1035 × wastage factor, rounded to 2 decimals.", { muted: true, italic: true });
  rr += 2;

  // --- Alloys
  section(wsRates, rr++, "Alloys", 8);
  headRow(wsRates, rr++, ["Short name", "Full name", "Base metal", "Purity", "Casting $/gm", "Surcharge $/gm", "Min grams", "SG"]);
  const aStart = rr;
  d.alloys.forEach((a) => {
    put(wsRates, `A${rr}`, "fixed", a.short);
    put(wsRates, `B${rr}`, "fixed", a.name || "");
    put(wsRates, `C${rr}`, "fixed", a.metal || "");
    put(wsRates, `D${rr}`, "input", a.purity, "0.000");
    put(wsRates, `E${rr}`, "input", a.castingGm, FMT.num2);
    put(wsRates, `F${rr}`, "input", a.surchargeGm, FMT.num2);
    put(wsRates, `G${rr}`, "input", a.minGms ?? 0, FMT.num2);
    put(wsRates, `H${rr}`, "fixed", a.sg ?? "", FMT.num2);
    rr++;
  });
  const aEnd = rr - 1;
  const rng = (col, s, e) => `Rates!$${col}$${s}:$${col}$${e}`;
  const R_AL_SHORT = rng("A", aStart, aEnd);
  const R_AL_NAME = rng("B", aStart, aEnd);
  const R_AL_METAL = rng("C", aStart, aEnd);
  const R_AL_PUR = rng("D", aStart, aEnd);
  const R_AL_CAST = rng("E", aStart, aEnd);
  const R_AL_SURC = rng("F", aStart, aEnd);
  const R_AL_MIN = rng("G", aStart, aEnd);
  rr += 1;

  // --- Currency
  section(wsRates, rr++, "Currency (units per 1 USD)", 8);
  headRow(wsRates, rr++, ["Currency", "Rate per USD"]);
  const cStart = rr;
  Object.entries(d.currencyRates || {}).forEach(([cur, rate]) => {
    put(wsRates, `A${rr}`, "fixed", cur);
    put(wsRates, `B${rr}`, "input", rate, FMT.rate4);
    rr++;
  });
  const cEnd = Math.max(rr - 1, cStart);
  const R_CUR_CODE = rng("A", cStart, cEnd);
  const R_CUR_RATE = rng("B", cStart, cEnd);
  label(wsRates, `A${rr}`, "Currency markup", { bold: true });
  put(wsRates, `B${rr}`, "input", d.currencyMarkup, FMT.rate4);
  const R_MARKUP = `Rates!$B$${rr}`;
  rr += 2;

  // --- Locations
  section(wsRates, rr++, "Locations (currency & duty)", 8);
  headRow(wsRates, rr++, ["Location", "Currency", "Duty %"]);
  const lStart = rr;
  d.locations.forEach((l) => {
    put(wsRates, `A${rr}`, "fixed", l.code);
    put(wsRates, `B${rr}`, "fixed", l.currency);
    put(wsRates, `C${rr}`, "input", l.duty, FMT.pct);
    rr++;
  });
  const lEnd = rr - 1;
  const R_LOC_CODE = rng("A", lStart, lEnd);
  const R_LOC_CUR = rng("B", lStart, lEnd);
  const R_LOC_DUTY = rng("C", lStart, lEnd);
  rr += 1;

  // --- CAD fees
  section(wsRates, rr++, "CAD fees ($)", 8);
  headRow(wsRates, rr++, ["CAD type", "Fee ($)"]);
  const fStart = rr;
  Object.entries(d.cadFees || {}).forEach(([t, fee]) => {
    put(wsRates, `A${rr}`, "fixed", t);
    put(wsRates, `B${rr}`, "input", fee, FMT.usd);
    rr++;
  });
  const fEnd = Math.max(rr - 1, fStart);
  const R_CAD_TYPE = rng("A", fStart, fEnd);
  const R_CAD_FEE = rng("B", fStart, fEnd);
  rr += 1;

  // --- Labor
  section(wsRates, rr++, "Labor", 8);
  label(wsRates, `A${rr}`, "Labor $ per gram", { bold: true });
  put(wsRates, `B${rr}`, "input", d.laborPerGm, FMT.usd);
  const R_LABOR_GM = `Rates!$B$${rr}`;
  rr++;
  label(wsRates, `A${rr}`, "Labor minimum (flat $)", { bold: true });
  put(wsRates, `B${rr}`, "input", d.laborMinFlat, FMT.usd);
  const R_LABOR_MIN = `Rates!$B$${rr}`;
  rr += 2;

  // --- Setting tiers
  section(wsRates, rr++, "Setting tiers (matched on weight per stone)", 8);
  headRow(wsRates, rr++, ["Tier", "Up to (ct/pc)", "Rate ($)", "Charged"]);
  const tStart = rr;
  d.settingTiers.forEach((t, i) => {
    put(wsRates, `A${rr}`, "fixed", i + 1);
    put(wsRates, `B${rr}`, "input", t.uptoCt, "0.000");
    put(wsRates, `C${rr}`, "input", t.rate, FMT.num2);
    put(wsRates, `D${rr}`, "input", t.type);
    rr++;
  });
  const tEnd = rr - 1;
  const R_TIER_UPTO = rng("B", tStart, tEnd);
  const R_TIER_RATE = rng("C", tStart, tEnd);
  const R_TIER_TYPE = rng("D", tStart, tEnd);
  label(wsRates, `A${rr}`, "A stone uses the first tier whose 'Up to' is ≥ its weight per piece (last tier if none). Tiers must be in ascending order. 'PER PC' = rate × pcs; 'PER CT' = rate × total ct.", { muted: true, italic: true });
  pageSetup(wsRates, false);

  // helper replicas for cached values --------------------------------
  const alloyBy = Object.fromEntries(d.alloys.map((a) => [a.short, a]));
  const metalCalc = (shortName, gram) => {
    const a = alloyBy[shortName];
    const g = gram || 0;
    const o = { a, g, purity: a ? a.purity : 0, cast: a ? a.castingGm : 0, surc: a ? a.surchargeGm : 0, min: a ? a.minGms ?? 0 : 0 };
    o.base = a ? baseByCode[a.metal] ?? 0 : 0;
    o.kicker = a && String(a.short).includes("WG-PD") ? baseByCode.PD ?? 0 : 0;
    o.alloyRate = o.base * o.purity + o.kicker;
    o.rateNet = o.alloyRate + o.cast;
    o.rateNetSurc = o.rateNet + o.surc;
    o.cost = !a || g <= 0 ? 0 : g < o.min ? Math.min(g * o.rateNetSurc, o.min * o.rateNet) : g * o.rateNet;
    return o;
  };

  // =====================================================================
  // METAL
  // =====================================================================
  title(wsMetal, "Metal — casting cost", "Cost of the metal itself for the primary and secondary alloy. Change an alloy (dropdown) or gram weight and the casting total updates.");
  widths(wsMetal, [38, 24, 24, 52]);
  headRow(wsMetal, 4, ["Item", "Primary", "Secondary", "How it's worked out"]);
  const mp = metalCalc(d.primary.short, d.primary.gramWt);
  const ms = metalCalc(d.secondary.short, d.secondary.gramWt);
  const mrows = [
    ["Alloy (short name)", "input", (m, X) => m.a?.short ?? "", null, "Pick from the dropdown (list on the Rates sheet)", null],
    ["Alloy name", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_NAME},MATCH(${X}5,${R_AL_SHORT},0)),"")`, m.a?.name ?? ""), null, "Looked up from the alloy table", null],
    ["Base metal", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_METAL},MATCH(${X}5,${R_AL_SHORT},0)),"")`, m.a?.metal ?? ""), null, "Looked up from the alloy table", null],
    ["Purity", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_PUR},MATCH(${X}5,${R_AL_SHORT},0)),0)`, m.purity), "0.000", "Looked up from the alloy table", null],
    ["Casting $/gm", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_CAST},MATCH(${X}5,${R_AL_SHORT},0)),0)`, m.cast), FMT.num2, "Looked up from the alloy table", null],
    ["Surcharge $/gm", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_SURC},MATCH(${X}5,${R_AL_SHORT},0)),0)`, m.surc), FMT.num2, "Looked up from the alloy table", null],
    ["Minimum grams", "calc", (m, X) => fx(`IFERROR(INDEX(${R_AL_MIN},MATCH(${X}5,${R_AL_SHORT},0)),0)`, m.min), FMT.num2, "Looked up from the alloy table", null],
    ["Gram weight", "input", (m, X) => m.g, FMT.num2, "Weight of this metal in the piece (g)", null],
    ["Base metal net $/gm", "calc", (m, X) => fx(`IFERROR(INDEX(${R_METAL_BASE},MATCH(${X}7,${R_METAL_CODE},0)),0)`, m.base), FMT.num2, "From Rates > Metal rates (PM rate ÷ 31.1035 × wastage)", null],
    ["Palladium add-on $/gm", "calc", (m, X) => fx(`IF(ISNUMBER(SEARCH("WG-PD",${X}5)),IFERROR(INDEX(${R_METAL_BASE},MATCH("PD",${R_METAL_CODE},0)),0),0)`, m.kicker), FMT.num2, "Only for '…WG-PD' alloys: adds the palladium net rate", null],
    ["Alloy metal rate $/gm", "calc", (m, X) => fx(`${X}13*${X}8+${X}14`, m.alloyRate), FMT.num2, "Base net × purity + palladium add-on", null],
    ["Rate incl. casting $/gm", "calc", (m, X) => fx(`${X}15+${X}9`, m.rateNet), FMT.num2, "Alloy metal rate + casting $/gm", null],
    ["Rate incl. casting + surcharge $/gm", "calc", (m, X) => fx(`${X}16+${X}10`, m.rateNetSurc), FMT.num2, "Used only for pieces under the minimum grams", null],
    ["Metal cost ($)", "calc", (m, X) => fx(`IF(${X}12<=0,0,IF(${X}12<${X}11,MIN(${X}12*${X}17,${X}11*${X}16),${X}12*${X}16))`, m.cost), FMT.usd, "Over the minimum: grams × rate incl. casting. Under it: the lower of grams × (rate incl. casting + surcharge) and minimum grams × rate incl. casting", { bold: true }],
  ];
  // Row numbers: items start at row 5.
  // 5 alloy, 6 name, 7 metal, 8 purity, 9 casting, 10 surcharge, 11 min, 12 gram,
  // 13 base, 14 pd, 15 alloy rate, 16 rateNet, 17 rateNetSurc, 18 cost
  mrows.forEach((row, i) => {
    const rowNum = 5 + i;
    label(wsMetal, `A${rowNum}`, row[0], { bold: !!(row[5] && row[5].bold) });
    [["B", mp], ["C", ms]].forEach(([X, m]) => {
      const v = row[2](m, X);
      put(wsMetal, `${X}${rowNum}`, row[1], v, row[3], { bold: !!(row[5] && row[5].bold), align: typeof v === "string" || (v && v.formula && typeof v.result === "string") ? "left" : undefined });
    });
    label(wsMetal, `D${rowNum}`, row[4], { muted: true, italic: true, wrap: true });
  });
  wsMetal.getCell("B5").dataValidation = { type: "list", allowBlank: false, formulae: [R_AL_SHORT] };
  wsMetal.getCell("C5").dataValidation = { type: "list", allowBlank: false, formulae: [R_AL_SHORT] };
  wsMetal.getRow(18).height = 42;
  const casting = Math.round(mp.cost + ms.cost);
  label(wsMetal, "A20", "Casting total ($)", { bold: true });
  put(wsMetal, "B20", "calc", fx("ROUND(B18+C18,0)", casting), FMT.usd, { bold: true });
  label(wsMetal, "D20", "Primary + secondary metal cost, rounded to a whole dollar", { muted: true, italic: true });
  label(wsMetal, "A21", "Total gram weight", { bold: true });
  const totalGrams = mp.g + ms.g;
  put(wsMetal, "B21", "calc", fx("B12+C12", totalGrams), FMT.num2);
  label(wsMetal, "D21", "Used for the labor charge", { muted: true, italic: true });
  wsMetal.views = [{ showGridLines: false, state: "frozen", ySplit: 4 }];
  pageSetup(wsMetal);

  // =====================================================================
  // STONES
  // =====================================================================
  title(wsStone, "Stones — diamonds & setting", "One line per stone row. $/ct comes from the price grid (see 'Rate basis'); everything to its right is calculated.");
  widths(wsStone, [5, 9, 10, 13, 13, 22, 13, 14, 17, 36, 11, 7, 12, 11, 13, 11, 10, 8, 12]);
  const SH = ["Pos", "Item Type", "Lab", "Stone Type", "Shape", "Size", "Size Code", "Quality Grade", "Proposed Quality", "Rate basis ($/ct source)", "Wt / pc (ct)", "Pcs", "Total Wt (ct)", "$ / ct", "Diamond $", "Setting rate", "Setting basis", "Mount?", "Setting $"];
  const HINT = ["", "", "", "input", "", "", "", "", "", "", "input", "input", "= Wt/pc × Pcs", "input", "= ROUND(Total Wt × $/ct)", "from tier table", "from tier table", "from Stone Type", "= by Setting basis"];
  headRow(wsStone, 4, SH);
  HINT.forEach((t, i) => {
    const c = wsStone.getCell(5, i + 1);
    c.value = t;
    c.font = { name: FONT, size: 8, italic: true, color: { argb: "FF6B7280" } };
    c.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };
  });
  wsStone.getRow(5).height = 24;
  const S0 = 6;
  let diamondTotal = 0;
  let settingSum = 0;
  let pcsSum = 0;
  let wtSum = 0;
  d.stones.forEach((s, i) => {
    const R = S0 + i;
    const wt = s.wtPerPc;
    const pcs = s.pcs;
    const totalWt = wt * pcs;
    const dia = Math.round(totalWt * s.perCt);
    const tierIdx = Math.min(d.settingTiers.filter((t) => t.uptoCt < wt).length, d.settingTiers.length - 1);
    const tier = d.settingTiers[tierIdx];
    const isMount = s.stoneType === "Mount";
    const settingAmt = isMount || pcs <= 0 ? 0 : tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs;
    diamondTotal += dia;
    settingSum += settingAmt;
    pcsSum += pcs;
    wtSum += totalWt;
    put(wsStone, `A${R}`, "fixed", s.pos, FMT.int, { align: "center" });
    put(wsStone, `B${R}`, "fixed", s.itemType || "", null, { align: "center" });
    put(wsStone, `C${R}`, "fixed", s.lab || "", null, { align: "center" });
    put(wsStone, `D${R}`, "input", s.stoneType);
    put(wsStone, `E${R}`, "fixed", s.shape || "");
    put(wsStone, `F${R}`, "fixed", s.size || "");
    put(wsStone, `G${R}`, "fixed", s.code || "");
    put(wsStone, `H${R}`, "fixed", s.quality || "");
    put(wsStone, `I${R}`, "fixed", s.proposedQuality || "");
    put(wsStone, `J${R}`, "fixed", s.basis || "", null, { wrap: true });
    put(wsStone, `K${R}`, "input", wt, "0.0000");
    put(wsStone, `L${R}`, "input", pcs, FMT.int);
    put(wsStone, `M${R}`, "calc", fx(`K${R}*L${R}`, totalWt), "0.0000");
    put(wsStone, `N${R}`, "input", s.perCt, FMT.usd);
    put(wsStone, `O${R}`, "calc", fx(`ROUND(M${R}*N${R},0)`, dia), FMT.usd0);
    put(wsStone, `P${R}`, "calc", fx(`INDEX(${R_TIER_RATE},MIN(SUMPRODUCT(--(${R_TIER_UPTO}<K${R}))+1,ROWS(${R_TIER_UPTO})))`, tier.rate), FMT.num2);
    put(wsStone, `Q${R}`, "calc", fx(`INDEX(${R_TIER_TYPE},MIN(SUMPRODUCT(--(${R_TIER_UPTO}<K${R}))+1,ROWS(${R_TIER_UPTO})))`, tier.type), null, { align: "center" });
    put(wsStone, `R${R}`, "calc", fx(`IF(D${R}="Mount","Yes","No")`, isMount ? "Yes" : "No"), null, { align: "center" });
    put(wsStone, `S${R}`, "calc", fx(`IF(OR(R${R}="Yes",L${R}<=0),0,IF(Q${R}="PER CT",P${R}*M${R},P${R}*L${R}))`, settingAmt), FMT.num2);
    wsStone.getRow(R).height = 28;
  });
  const SL = S0 + d.stones.length - 1;
  const ST = SL + 1;
  // Dropdowns on the stone lines (and a few spare rows below the totals are
  // deliberately not covered -- the sheet is one row per existing stone line).
  const dd = d.dropdowns || {};
  // Excel limits an inline list to 255 characters; skip (no dropdown) rather than write a broken file.
  const listDV = (arr) => {
    const joined = arr.join(",");
    return joined.length <= 250 ? { type: "list", allowBlank: true, formulae: [`"${joined}"`] } : undefined;
  };
  // One validation per column range (setting it cell-by-cell makes ExcelJS emit overlapping ranges).
  const addDV = (col, arr) => {
    const v = arr && arr.length ? listDV(arr) : undefined;
    if (v && SL >= S0) wsStone.dataValidations.add(`${col}${S0}:${col}${SL}`, v);
  };
  addDV("B", dd.itemTypes);
  addDV("C", dd.labs);
  addDV("D", dd.stoneTypes);
  addDV("I", dd.proposedQualities);
  for (let c = 1; c <= 19; c++) {
    const cell = wsStone.getCell(ST, c);
    cell.fill = FILL("FFE6EDF7");
    cell.border = BORDER;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } };
  }
  wsStone.getCell(`A${ST}`).value = "Totals";
  put(wsStone, `L${ST}`, "calc", fx(`SUM(L${S0}:L${SL})`, pcsSum), FMT.int, { bold: true });
  put(wsStone, `M${ST}`, "calc", fx(`SUM(M${S0}:M${SL})`, wtSum), "0.0000", { bold: true });
  put(wsStone, `O${ST}`, "calc", fx(`SUM(O${S0}:O${SL})`, diamondTotal), FMT.usd0, { bold: true });
  const settingTotal = Math.round(settingSum);
  put(wsStone, `S${ST}`, "calc", fx(`ROUND(SUM(S${S0}:S${SL}),0)`, settingTotal), FMT.usd0, { bold: true });
  [`L${ST}`, `M${ST}`, `O${ST}`, `S${ST}`].forEach((a) => (wsStone.getCell(a).fill = FILL("FFE6EDF7")));
  label(wsStone, `A${ST + 2}`, "Diamond $ total = sum of each line's Diamond $ (each already rounded). Setting $ total = sum of each line's Setting $ (unrounded), then rounded once.", { muted: true, italic: true });
  wsStone.views = [{ showGridLines: false, state: "frozen", ySplit: 5, xSplit: 1 }];
  pageSetup(wsStone);
  const S_DIAMOND = `Stones!$O$${ST}`;
  const S_SETTING = `Stones!$S$${ST}`;

  // =====================================================================
  // CHARGES
  // =====================================================================
  title(wsChg, "Charges — labor, CAD, additional", "Labor and CAD fee use the tables on the Rates sheet. The additional charge is a typed amount in USD.");
  widths(wsChg, [38, 24, 60]);
  headRow(wsChg, 4, ["Item", "Value", "How it's worked out"]);
  const laborByWt = totalGrams * d.laborPerGm;
  const labor = Math.round(Math.max(laborByWt, d.laborMinFlat));
  const cadFee = Math.round(d.cadFees[d.cadType] ?? 0);
  const addAmt = d.additional.amount || 0;
  label(wsChg, "A5", "Total gram weight", {});
  put(wsChg, "B5", "calc", fx("Metal!B21", totalGrams), FMT.num2);
  label(wsChg, "C5", "From the Metal sheet", { muted: true, italic: true });
  label(wsChg, "A6", "Labor $ per gram");
  put(wsChg, "B6", "calc", fx(R_LABOR_GM, d.laborPerGm), FMT.usd);
  label(wsChg, "C6", "From Rates > Labor", { muted: true, italic: true });
  label(wsChg, "A7", "Labor by weight ($)");
  put(wsChg, "B7", "calc", fx("B5*B6", laborByWt), FMT.usd);
  label(wsChg, "C7", "Grams × labor $/gm", { muted: true, italic: true });
  label(wsChg, "A8", "Labor minimum ($)");
  put(wsChg, "B8", "calc", fx(R_LABOR_MIN, d.laborMinFlat), FMT.usd);
  label(wsChg, "C8", "From Rates > Labor", { muted: true, italic: true });
  label(wsChg, "A9", "Labor charged ($)", { bold: true });
  put(wsChg, "B9", "calc", fx("ROUND(MAX(B7,B8),0)", labor), FMT.usd, { bold: true });
  label(wsChg, "C9", "The larger of labor by weight and the minimum, rounded to a whole dollar", { muted: true, italic: true });
  label(wsChg, "A11", "CAD type");
  put(wsChg, "B11", "input", d.cadType || "");
  wsChg.getCell("B11").dataValidation = { type: "list", allowBlank: true, formulae: [R_CAD_TYPE] };
  label(wsChg, "C11", "Pick from the dropdown", { muted: true, italic: true });
  label(wsChg, "A12", "CAD fee ($)", { bold: true });
  put(wsChg, "B12", "calc", fx(`ROUND(IFERROR(INDEX(${R_CAD_FEE},MATCH(B11,${R_CAD_TYPE},0)),0),0)`, cadFee), FMT.usd, { bold: true });
  label(wsChg, "C12", "Looked up from Rates > CAD fees (0 if the type isn't listed)", { muted: true, italic: true });
  label(wsChg, "A14", "Additional charge — name");
  put(wsChg, "B14", "input", d.additional.name || "");
  label(wsChg, "A15", "Additional charge ($, USD)", { bold: true });
  put(wsChg, "B15", "input", addAmt, FMT.usd, { bold: true });
  label(wsChg, "C15", "Typed amount; goes into the gross total before duty and currency conversion", { muted: true, italic: true });
  pageSetup(wsChg, false);

  // =====================================================================
  // PRICING
  // =====================================================================
  title(wsPrice, "Pricing — from components to final price", "Adds the components, applies duty and currency, rounds up to the next 5, then applies a manual override if one is set.");
  widths(wsPrice, [40, 24, 62]);
  headRow(wsPrice, 4, ["Step", "Value", "How it's worked out"]);
  const locInfo = d.locations.find((l) => l.code === d.location) || d.locations[0];
  const curRateRaw = d.currencyRates[locInfo.currency] ?? 0;
  const fxApplied = locInfo.currency === "USD" ? 1 : (curRateRaw || 1) * d.currencyMarkup;
  const gross = casting + labor + cadFee + diamondTotal + settingTotal + addAmt;
  const totalUSD = ceil5(gross * (1 + locInfo.duty));
  const totalLocal = ceil5(totalUSD * fxApplied);
  const hasOverride = typeof d.manualOverride === "number" && d.manualOverride > 0;
  const finalLocal = hasOverride ? d.manualOverride : totalLocal;
  const P = (row, lab, kind, val, fmt, how, bold) => {
    label(wsPrice, `A${row}`, lab, { bold: !!bold });
    put(wsPrice, `B${row}`, kind, val, fmt, { bold: !!bold, align: typeof val === "string" ? "left" : undefined });
    label(wsPrice, `C${row}`, how, { muted: true, italic: true, wrap: true });
  };
  P(5, "Location", "input", locInfo.code, null, "Pick from the dropdown (list on the Rates sheet)");
  wsPrice.getCell("B5").dataValidation = { type: "list", allowBlank: false, formulae: [R_LOC_CODE] };
  P(6, "Currency", "calc", fx(`IFERROR(INDEX(${R_LOC_CUR},MATCH(B5,${R_LOC_CODE},0)),"")`, locInfo.currency), null, "Looked up from Rates > Locations");
  P(7, "Duty %", "calc", fx(`IFERROR(INDEX(${R_LOC_DUTY},MATCH(B5,${R_LOC_CODE},0)),0)`, locInfo.duty), FMT.pct, "Looked up from Rates > Locations");
  P(8, "Currency rate (per USD)", "calc", fx(`IFERROR(INDEX(${R_CUR_RATE},MATCH(B6,${R_CUR_CODE},0)),0)`, curRateRaw), FMT.rate4, "Looked up from Rates > Currency (0 if the currency isn't listed)");
  P(9, "Currency markup", "calc", fx(R_MARKUP, d.currencyMarkup), FMT.rate4, "From Rates > Currency");
  P(10, "FX rate applied", "calc", fx(`IF(B6="USD",1,IF(B8=0,1,B8)*B9)`, fxApplied), FMT.rate4, "USD = 1. Otherwise currency rate × markup (a missing rate counts as 1)", true);
  section(wsPrice, 12, "Roll-up (USD)", 3);
  P(13, "Casting", "calc", fx("Metal!B20", casting), FMT.usd, "Metal sheet");
  P(14, "Labor", "calc", fx("Charges!B9", labor), FMT.usd, "Charges sheet");
  P(15, "CAD fee", "calc", fx("Charges!B12", cadFee), FMT.usd, "Charges sheet");
  P(16, "Diamonds", "calc", fx(S_DIAMOND, diamondTotal), FMT.usd, "Stones sheet total");
  P(17, "Setting", "calc", fx(S_SETTING, settingTotal), FMT.usd, "Stones sheet total");
  P(18, "Additional charge", "calc", fx("Charges!B15", addAmt), FMT.usd, "Charges sheet");
  P(19, "Gross total (USD)", "calc", fx("SUM(B13:B18)", gross), FMT.usd, "Sum of the six components above", true);
  P(20, "Total with duty (USD)", "calc", fx("CEILING(B19*(1+B7),5)", totalUSD), FMT.usd, "Gross × (1 + duty), rounded UP to the next 5", true);
  P(21, "Total with duty (local currency)", "calc", fx("CEILING(B20*B10,5)", totalLocal), FMT.num2, "USD total × FX rate, rounded UP to the next 5", true);
  section(wsPrice, 23, "Manual override", 3);
  P(24, "Manual price override (local currency)", "input", hasOverride ? d.manualOverride : null, FMT.num2, "Leave blank for no override. A number above 0 replaces the calculated price.");
  P(25, "FINAL PRICE (local currency)", "calc", fx("IF(AND(ISNUMBER(B24),B24>0),B24,B21)", finalLocal), FMT.num2, "Override if set, otherwise the total with duty (local)", true);
  wsPrice.getCell("B25").font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
  wsPrice.getCell("B25").fill = FILL("FFE6EDF7");
  P(26, "Currency of final price", "calc", fx("B6", locInfo.currency), null, "");
  pageSetup(wsPrice, false);

  // =====================================================================
  // SUMMARY
  // =====================================================================
  title(wsSum, "Calculation check — summary", "'App value' is what the Calculator showed when this file was made. 'Excel value' is recalculated here from the yellow inputs.");
  widths(wsSum, [36, 20, 20, 16, 14, 4]);
  const H = d.header || {};
  const headItems = [
    ["Job No", H.jobNo], ["Item No", H.itemNo], ["Style code", H.styleCode], ["Customer", H.customer],
    ["Designer", H.designer], ["Item type", H.itemType], ["CAD type", H.cadType], ["Quote stage", H.stage],
    ["Print date", H.printDate], ["Location / currency", `${locInfo.code} / ${locInfo.currency}`],
    ["File generated", (d.exportedAt || new Date()).toLocaleString()],
  ];
  let sr = 4;
  headItems.forEach(([k, v]) => {
    label(wsSum, `A${sr}`, k, { bold: true });
    wsSum.mergeCells(`B${sr}:E${sr}`);
    put(wsSum, `B${sr}`, "fixed", v == null || v === "" ? "—" : String(v), null, { align: "left" });
    for (const c of ["C", "D", "E"]) wsSum.getCell(`${c}${sr}`).border = BORDER;
    sr++;
  });
  sr += 1;
  const overallRow = sr;
  sr += 2;
  headRow(wsSum, sr, ["Component", "App value", "Excel value", "Difference", "Status"]);
  const tableHead = sr;
  sr++;
  const A = d.app;
  const comps = [
    ["Casting (USD)", A.casting, "Pricing!B13", casting, FMT.usd, 0.005],
    ["Labor (USD)", A.labor, "Pricing!B14", labor, FMT.usd, 0.005],
    ["CAD fee (USD)", A.cadFee, "Pricing!B15", cadFee, FMT.usd, 0.005],
    ["Diamonds (USD)", A.diamondTotal, "Pricing!B16", diamondTotal, FMT.usd, 0.005],
    ["Setting (USD)", A.settingTotal, "Pricing!B17", settingTotal, FMT.usd, 0.005],
    ["Additional charge (USD)", A.additionalChargeUSD, "Pricing!B18", addAmt, FMT.usd, 0.005],
    ["Gross total (USD)", A.grossTotalUSD, "Pricing!B19", gross, FMT.usd, 0.005],
    ["Total with duty (USD)", A.totalWithDutyUSD, "Pricing!B20", totalUSD, FMT.usd, 0.005],
    ["FX rate applied", A.fxRate, "Pricing!B10", fxApplied, FMT.rate4, 0.00005],
    ["Total with duty (local)", A.totalWithDutyLocal, "Pricing!B21", totalLocal, FMT.num2, 0.005],
    ["FINAL PRICE (local)", A.effectiveTotalLocal, "Pricing!B25", finalLocal, FMT.num2, 0.005],
  ];
  const sumStart = sr;
  let diffs = 0;
  comps.forEach(([name, appV, ref, calcV, fmt, tol]) => {
    const isFinal = name.startsWith("FINAL");
    label(wsSum, `A${sr}`, name, { bold: isFinal });
    put(wsSum, `B${sr}`, "fixed", appV, fmt, { bold: isFinal });
    put(wsSum, `C${sr}`, "calc", fx(ref, calcV), fmt, { bold: isFinal });
    const diff = calcV - appV;
    put(wsSum, `D${sr}`, "calc", fx(`C${sr}-B${sr}`, diff), fmt === FMT.rate4 ? FMT.rate4 : FMT.num2);
    const ok = Math.abs(diff) < tol;
    if (!ok) diffs++;
    put(wsSum, `E${sr}`, "calc", fx(`IF(ABS(D${sr})<${tol},"OK","CHECK")`, ok ? "OK" : "CHECK"), null, { align: "center", bold: true });
    sr++;
  });
  const sumEnd = sr - 1;
  const overall = diffs === 0 ? "ALL MATCH — the Excel recalculation agrees with the app" : `${diffs} item(s) differ — see rows marked CHECK`;
  wsSum.mergeCells(`A${overallRow}:E${overallRow}`);
  const oc = wsSum.getCell(`A${overallRow}`);
  oc.value = fx(`IF(COUNTIF(E${sumStart}:E${sumEnd},"CHECK")=0,"ALL MATCH — the Excel recalculation agrees with the app",COUNTIF(E${sumStart}:E${sumEnd},"CHECK")&" item(s) differ — see rows marked CHECK")`, overall);
  oc.font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
  oc.alignment = { vertical: "middle", horizontal: "center" };
  oc.fill = FILL("FFE6EDF7");
  oc.border = BORDER;
  wsSum.getRow(overallRow).height = 26;
  const okStyle = { font: { color: { argb: "FF006100" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } } };
  const badStyle = { font: { color: { argb: "FF9C0006" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } } };
  wsSum.addConditionalFormatting({
    ref: `E${sumStart}:E${sumEnd}`,
    rules: [
      { type: "cellIs", operator: "equal", formulae: ['"OK"'], style: okStyle },
      { type: "cellIs", operator: "equal", formulae: ['"CHECK"'], style: badStyle },
    ],
  });
  wsSum.addConditionalFormatting({
    ref: `A${overallRow}:E${overallRow}`,
    rules: [
      { type: "expression", formulae: [`LEFT($A$${overallRow},3)="ALL"`], style: okStyle },
      { type: "expression", formulae: [`LEFT($A$${overallRow},3)<>"ALL"`], style: badStyle },
    ],
  });
  label(wsSum, `A${sr + 1}`, "Once you change a yellow input anywhere, 'Excel value' moves away from 'App value' — that's expected: the difference shows the effect of your change.", { muted: true, italic: true, wrap: true });
  wsSum.mergeCells(`A${sr + 1}:E${sr + 2}`);
  wsSum.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];
  pageSetup(wsSum, false);

  // =====================================================================
  // README
  // =====================================================================
  title(wsRead, "JWY Calculator — calculation check workbook", "Every number behind this quote, split by use, with live formulas.");
  widths(wsRead, [26, 78]);
  let rd = 4;
  section(wsRead, rd++, "Colour code", 2);
  [["input", "Input — safe to change. Yellow cell, blue text."], ["calc", "Formula — worked out for you. Don't overwrite."], ["fixed", "Fixed — text or number exactly as the app had it."]].forEach(([k, t]) => {
    put(wsRead, `A${rd}`, k, k === "input" ? "123" : k === "calc" ? "=123" : "abc", null, { align: "center" });
    label(wsRead, `B${rd}`, t);
    rd++;
  });
  rd++;
  section(wsRead, rd++, "Sheets", 2);
  [
    ["Summary", "Start here. App value vs Excel recalculation for every component, with OK / CHECK."],
    ["Metal", "Casting: alloy, purity, metal rate, minimum-gram rule, cost. Change the alloy (dropdown) or grams."],
    ["Stones", "Each stone line: weight, pcs, $/ct, diamond $, setting rate and setting $."],
    ["Charges", "Labor (per gram vs minimum), CAD fee, additional charge."],
    ["Pricing", "Gross total → duty → currency → rounded local price → manual override → final price."],
    ["Rates", "The tables the formulas read: metal rates, alloys, currency, locations, CAD, labor, setting tiers."],
  ].forEach(([a, b]) => {
    label(wsRead, `A${rd}`, a, { bold: true });
    label(wsRead, `B${rd}`, b, { wrap: true });
    rd++;
  });
  rd++;
  section(wsRead, rd++, "How to check a quote", 2);
  [
    "1. Open Summary. If every row says OK, the app's numbers reproduce exactly from the data in this file.",
    "2. If something looks wrong, find the component on its own sheet (Metal, Stones, Charges, Pricing) and read down the working.",
    "3. To test a different value, change a yellow cell (for example $/ct on Stones, or grams on Metal). Everything downstream recalculates.",
    "4. Summary then shows how far the new Excel value is from the original App value.",
  ].forEach((t) => {
    wsRead.mergeCells(`A${rd}:B${rd}`);
    label(wsRead, `A${rd}`, t, { wrap: true });
    rd++;
  });
  rd++;
  section(wsRead, rd++, "What this file does and doesn't re-derive", 2);
  [
    "• $/ct for each stone line is an INPUT here (the price grids live in the Google Sheet). The 'Rate basis' column says which grid row/band the app used. Everything after $/ct is a formula.",
    "• Setting rates are looked up from the tier table on Rates using each stone's weight per piece.",
    "• Metal, labor, CAD, duty, currency, rounding (to whole dollars; up to the next 5) all follow the Calculator's own rules.",
  ].forEach((t) => {
    wsRead.mergeCells(`A${rd}:B${rd}`);
    label(wsRead, `A${rd}`, t, { wrap: true });
    wsRead.getRow(rd).height = 30;
    rd++;
  });
  rd++;
  section(wsRead, rd++, "Data sources at export time", 2);
  const src = d.sources || {};
  [
    ["Metal rates", d.manualRatesOn ? "MANUAL override switched on in the app" : src.metalRates || "—"],
    ["Alloys", src.alloys || "—"],
    ["Currency rates", src.currencyRates || "—"],
    ["Locations", src.locations || "—"],
    ["CAD fees & labor", src.cadFeesAndLabor || "—"],
    ["Setting tiers", src.settingTiers || "—"],
    ["Natural diamond prices", src.naturalPrices || "—"],
    ["Lab-grown prices", src.labGrownPrices || "—"],
  ].forEach(([a, b]) => {
    label(wsRead, `A${rd}`, a, { bold: true });
    label(wsRead, `B${rd}`, `${b}${b === "sample" ? "  (built-in sample values, not the live sheet)" : ""}`);
    rd++;
  });
  pageSetup(wsRead, false);

  wb.views = [{ activeTab: 1 }];
  // Optional hook: lets a caller add extra reference sheets / swap input cells
  // for formulas before the file is written (used for the standalone
  // "Pricing Structure" reference workbook; the in-app export doesn't use it).
  if (typeof d.extend === "function") {
    await d.extend(wb, {
      helpers: { put, fx, label, title, headRow, section, widths, pageSetup, FMT, FILL, BORDER, NAVY, FONT, KIND },
      stones: { S0, SL, ST },
      refs: { R_TIER_UPTO, R_TIER_RATE, R_TIER_TYPE, R_METAL_CODE, R_METAL_BASE },
      sheets: { wsRead, wsSum, wsMetal, wsStone, wsChg, wsPrice, wsRates },
    });
  }
  return wb.xlsx.writeBuffer();
}
