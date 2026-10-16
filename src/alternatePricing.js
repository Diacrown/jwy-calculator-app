// Alternate pricing for the same piece -- two independent ideas, kept separate:
//
//  1. ALTERNATE METAL: the same design (same stones) made in a different gold /
//     platinum / silver alloy. Weights are derived from the quote's own metal
//     weights by specific gravity (same volume, different density), then casting,
//     labor and totals are worked out with exactly the same rules as the main
//     quote. Everything is automatic.
//
//  2. ALTERNATE STONES: the same piece with the diamonds quoted at a different
//     quality / type (e.g. mined TW VS, lab-grown D/VS1). Each diamond line is
//     re-priced from the built-in price tables where a price exists; any line that
//     cannot be priced automatically keeps its quoted price (and is listed as
//     such), and the whole diamond total can be typed in by hand instead.
//
// Pure functions only: the calculator passes in everything it already knows
// (tables, rates, helpers), so nothing here can change the main quote.

export const ALT_COLUMNS = 4;
export const NATURAL_GRADES = ["TW VS", "TW SI1", "TW SI2", "TW SI3", "TW I1", "WH SI", "IJ SI2-I1"];
export const LGD_GRADES = ["D/VVS2", "D/VS1", "Non-cert"];

const num = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** Grams in `to` that occupy the same volume as `grams` in `from` (specific gravity ratio). */
export function scaleGrams(grams, from, to) {
  const g = num(grams);
  if (!(g > 0) || !from || !to || !(from.sg > 0) || !(to.sg > 0)) return 0;
  return round2((g * to.sg) / from.sg);
}

/** Money part shared by both kinds of alternate: from the gross total to duty / local / SSP. */
function finish(grossUSD, ctx) {
  const withDutyUSD = ctx.roundUp5(grossUSD * (1 + ctx.duty));
  const local = ctx.roundUp5(withDutyUSD * ctx.fxRate);
  return { grossUSD, withDutyUSD, local, ssp: ctx.encodeSsp(withDutyUSD) };
}

/**
 * One "alternate metal" column.
 *   col   { primary: shortName, secondary: shortName | "" }   ("" = same as primary)
 *   base  { primaryAlloy, primaryGramWt, secondaryAlloy|null, secondaryGramWt }
 *   ctx   { alloys, metalRates, castingCost(g, alloy, rates), laborPerGm, laborMinFlat,
 *           cadFee, diamondTotal, settingTotal, additionalChargeUSD, duty, fxRate,
 *           roundUp5, encodeSsp }
 * Returns null while the column is unfilled or the quote has no metal weight yet.
 */
export function altMetalColumn(col, base, ctx) {
  const altPrimary = ctx.alloys.find((a) => a.short === col.primary);
  if (!altPrimary) return null;
  const altSecondary = (col.secondary && ctx.alloys.find((a) => a.short === col.secondary)) || altPrimary;

  const baseSecondaryG = base.secondaryAlloy ? num(base.secondaryGramWt) : 0;
  const primaryG = scaleGrams(base.primaryGramWt, base.primaryAlloy, altPrimary);
  const secondaryG = baseSecondaryG > 0 ? scaleGrams(baseSecondaryG, base.secondaryAlloy, altSecondary) : 0;
  const totalG = primaryG + secondaryG;
  if (!(totalG > 0)) return null;

  const casting = Math.round(
    ctx.castingCost(primaryG, altPrimary, ctx.metalRates) + ctx.castingCost(secondaryG, altSecondary, ctx.metalRates)
  );
  const labor = Math.round(Math.max(totalG * ctx.laborPerGm, ctx.laborMinFlat));
  const gross = casting + labor + ctx.cadFee + ctx.diamondTotal + ctx.settingTotal + ctx.additionalChargeUSD;
  return {
    primaryShort: altPrimary.short,
    secondaryShort: baseSecondaryG > 0 ? altSecondary.short : "",
    primaryG,
    secondaryG,
    totalG,
    casting,
    labor,
    ...finish(gross, ctx),
  };
}

/** Label for a stone option, as shown on screen and on the customer PDF. */
export function stoneOptionLabel(col) {
  if (!col || !col.kind || col.kind === "none") return "";
  if (col.label && col.label.trim()) return col.label.trim();
  if (col.kind === "natural") return `Mined · ${col.grade}`;
  if (col.kind === "lgd") return `Lab grown · ${col.grade}`;
  if (col.kind === "manual") return "Alternate stones";
  return "";
}

/**
 * Price of one diamond line under an alternate option, or the reason it keeps its quoted price.
 * Returns { perCt, total, changed, note }.
 */
export function altRowPrice(row, calc, col, t) {
  const keep = (note) => ({ perCt: calc.perCt, total: calc.total, changed: false, note });
  const pcs = num(row.pcs);
  if (pcs <= 0 || !(calc.totalWt > 0)) return keep("");
  const stoneType = row.stoneTypeSel || "Mined";
  const isMount = !row.typeCustom && (stoneType === "Mount" || stoneType === "Semi-Mount");
  if (isMount) return keep("mount");
  if (row.stoneTypeSel === "Plain") return keep("");
  if (row.sizeCode === t.customCode) return keep("custom size priced by hand");
  if (row.typeCustom || (stoneType !== "Mined" && stoneType !== "Lab grown")) return keep(`${row.typeCustom ? row.customType || "custom" : stoneType} priced by hand`);
  const size = t.diaSize.find((d) => d.key === row.sizeCode);
  if (!size) return keep("");

  let perCt = 0;
  if (col.kind === "natural") {
    perCt = size.group ? ((t.naturalPrices || {})[size.group] || {})[col.grade] : ((t.fancyPrices || {})[size.key] || {})[col.grade];
  } else if (col.kind === "lgd") {
    const shape = (row.mode || "natural") === "lgd" ? row.lgdShape : size.shape === "Round" ? "RND" : "FANCY";
    const band = (t.lgdBands || []).find((b) => (b.shape === shape || b.shape === "RND & FANCY") && size.wt >= b.minCt && size.wt <= b.maxCt);
    if (band) perCt = col.grade === "D/VVS2" ? band.dvvs2 : col.grade === "D/VS1" ? band.dvs1 : band.nonCert;
  }
  if (!(perCt > 0)) return keep(`no ${col.grade} price at this size`);
  return { perCt, total: Math.round(calc.totalWt * perCt), changed: true, note: "" };
}

/**
 * One "alternate stones" column.
 *   col   { kind: "natural"|"lgd"|"manual", grade, manualTotal, label }
 *   rows / rowCalcs   the quote's stone rows and their calculated lines
 *   t     { diaSize, naturalPrices, fancyPrices, lgdBands, customCode }
 *   ctx   { casting, labor, cadFee, settingTotal, additionalChargeUSD, duty, fxRate, roundUp5, encodeSsp }
 */
export function altStoneColumn(col, rows, rowCalcs, t, ctx) {
  if (!col || !col.kind || col.kind === "none") return null;
  let diamondTotal = 0;
  let changed = 0;
  const kept = [];
  const lines = [];

  if (col.kind === "manual") {
    const typed = num(col.manualTotal);
    if (!(typed > 0)) return null;
    diamondTotal = Math.round(typed);
  } else {
    rows.forEach((row, i) => {
      const c = rowCalcs[i];
      if (!c || !(c.totalWt > 0)) return;
      const r = altRowPrice(row, c, col, t);
      diamondTotal += r.total;
      lines.push({ index: i, perCt: r.perCt, total: r.total, changed: r.changed });
      if (r.changed) changed++;
      else if (r.note && r.note !== "mount") kept.push({ index: i, note: r.note });
    });
    if (!changed) return { label: stoneOptionLabel(col), empty: true, diamondTotal, changed, kept, lines, manual: false };
  }

  const gross = ctx.casting + ctx.labor + ctx.cadFee + diamondTotal + ctx.settingTotal + ctx.additionalChargeUSD;
  return {
    label: stoneOptionLabel(col),
    manual: col.kind === "manual",
    empty: false,
    diamondTotal,
    changed,
    kept,
    lines,
    ...finish(gross, ctx),
  };
}
