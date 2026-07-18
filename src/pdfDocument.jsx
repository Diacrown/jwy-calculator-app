import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

// Standard PDF fonts (Helvetica, Times-Roman) are part of the PDF spec
// itself -- every PDF reader on every platform has them built in. This
// is what actually fixes cross-viewer rendering, rather than just hoping
// a browser's print-to-PDF step embeds a web font correctly.
const ROSE = "#9C4A63";
const INK = "#241B1E";
const MUTED = "#7A6870";
const HAIRLINE = "#E8D9DE";
const TINT = "#FBF5F7";

const s = StyleSheet.create({
  page: { padding: "50pt 34pt 40pt", fontFamily: "Helvetica", fontSize: 9, color: INK },
  fixedHeader: {
    position: "absolute",
    top: 14,
    left: 34,
    right: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderBottom: `0.5pt solid ${HAIRLINE}`,
    paddingBottom: 4,
  },
  fixedFooter: {
    position: "absolute",
    bottom: 16,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTop: `0.5pt solid ${HAIRLINE}`,
    paddingTop: 4,
    fontSize: 7,
    color: MUTED,
  },
  letterhead: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottom: `1.5pt solid ${ROSE}`,
    paddingBottom: 10,
    marginBottom: 14,
  },
  letterheadLeft: { flex: 1, flexDirection: "row", alignItems: "center" },
  letterheadCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  letterheadRight: { flex: 1, alignItems: "flex-end" },
  quoteTitle: { fontSize: 15, fontWeight: 700, fontFamily: "Times-Roman" },
  jobInfoLine: { fontSize: 8.5, color: MUTED, marginBottom: 2, flexDirection: "row", gap: 3 },
  jobInfoBold: { color: INK, fontWeight: 700 },
  stageBadge: { backgroundColor: ROSE, color: "#fff", fontSize: 7, fontWeight: 700, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, marginLeft: 4 },

  cadSection: { marginBottom: 14 },
  imageColLabel: { fontSize: 7, letterSpacing: 0.5, textTransform: "uppercase", color: MUTED, marginBottom: 4 },
  imageGridFull: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  imageThumbFull: { width: 170, height: 130, objectFit: "contain", border: `0.5pt solid ${HAIRLINE}`, borderRadius: 3 },

  specStrip: { flexDirection: "row", border: `0.5pt solid ${HAIRLINE}`, borderRadius: 4, marginBottom: 14 },
  specCell: { flex: 1, padding: 8, borderLeft: `0.5pt solid ${HAIRLINE}` },
  specCellFirst: { flex: 1, padding: 8 },
  specLabel: { fontSize: 7, textTransform: "uppercase", color: MUTED, marginBottom: 2 },
  specValue: { fontSize: 9, fontWeight: 700 },

  sectionLabel: { fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ROSE, marginBottom: 5 },

  tableHeaderRow: { flexDirection: "row", backgroundColor: ROSE },
  th: { color: "#fff", fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", padding: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5pt solid ${HAIRLINE}` },
  trAlt: { backgroundColor: TINT },
  td: { fontSize: 8, padding: 4 },
  tdR: { fontSize: 8, padding: 4, textAlign: "right" },

  remarksBox: { marginTop: 4, marginBottom: 14, padding: 8, backgroundColor: TINT, borderRadius: 4 },
  remarksLabel: { fontSize: 7, textTransform: "uppercase", color: MUTED, marginBottom: 3, letterSpacing: 0.5 },
  remarksText: { fontSize: 8.5, lineHeight: 1.4 },

  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 4 },
  totalsLine: { flexDirection: "row", width: 260, justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { fontSize: 8.5 },
  totalsLabelMuted: { fontSize: 8, color: MUTED, fontStyle: "italic" },
  totalsValue: { fontSize: 8.5, fontVariant: "tabular-nums" },
  grandTotalBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 260,
    backgroundColor: ROSE,
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  grandTotalLabel: { fontSize: 9, color: "#fff", fontWeight: 700 },
  grandTotalValue: { fontSize: 12, color: "#fff", fontWeight: 700 },

  bigPriceBlock: { alignItems: "flex-end", marginTop: 10 },
  bigPriceLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 0.8, color: MUTED, marginBottom: 3 },
  bigPriceValue: { fontSize: 24, fontWeight: 700, color: ROSE },
});

// Safety guard: never let a link to this app's own domain end up on a
// customer-facing PDF. PDF readers auto-linkify plain URL text, so if
// someone accidentally pastes the calculator's own address into the "3D
// render link" field (meant for an external Sketchfab/turntable URL), it
// would otherwise become a clickable path straight into the internal
// tool. Matches the production domain and any Netlify branch-preview
// variant of the same site (e.g. "testing--jwy-calculator.netlify.app").
const OWN_APP_DOMAIN_FRAGMENT = "jwy-calculator";
function isOwnAppLink(url) {
  return typeof url === "string" && url.toLowerCase().includes(OWN_APP_DOMAIN_FRAGMENT);
}

const fmt = (n, dp = 2) =>
  isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "0.00";

// AUD/NZD spelled out per request, rather than the A$/NZ$ shorthand.
const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", AUD: "AUD $", NZD: "NZD $", PLN: "zł", INR: "₹" };
const fmtC = (n, dp = 2) => "$" + fmt(n, dp);
const fmtL = (n, code, dp = 2) => (CURRENCY_SYMBOLS[code] || "$") + fmt(n, dp);

// Shape/size cell text -- suppresses the internal "manual entry"
// placeholder that the app uses on-screen, since it reads like leftover
// debug text on a customer-facing document. A custom row still shows its
// actual shape/description, just without that generic suffix.
function shapeSizeText(c) {
  if (c.size === "manual entry") return c.shape || "—";
  return `${c.shape} · ${c.size}`;
}

export function QuotePdfDocument({
  variant,
  jobInfo,
  locInfo,
  primaryAlloy,
  primaryGramWt,
  secondaryAlloy,
  secondaryGramWt,
  rowsWithCalcs,
  totals,
  casting,
  labor,
  cadFee,
  totalWithDutyUSD,
  totalWithDutyLocal,
  fxRate,
  cadImages,
  turntableLink,
  quoteStage,
  hasOverride,
  effectiveTotalLocal,
  logoBlack,
  printDate,
}) {
  const showPrices = variant === "full";
  const dateText = printDate ? new Date(printDate).toLocaleDateString() : new Date().toLocaleDateString();

  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View style={s.fixedHeader} fixed>
          {logoBlack && <Image src={logoBlack} style={{ width: 14, height: 11 }} />}
        </View>

        <View style={s.letterhead}>
          <View style={s.letterheadLeft}>{logoBlack && <Image src={logoBlack} style={{ width: 34, height: 27 }} />}</View>
          <View style={s.letterheadCenter}>
            <Text style={s.quoteTitle}>Order Quotation</Text>
          </View>
          <View style={s.letterheadRight}>
            <View style={s.jobInfoLine}>
              <Text style={s.jobInfoBold}>Job:</Text>
              <Text>{jobInfo.jobNo || "—"}</Text>
              {quoteStage ? <Text style={s.stageBadge}>{quoteStage}</Text> : null}
            </View>
            <View style={s.jobInfoLine}>
              <Text style={s.jobInfoBold}>Item:</Text>
              <Text>{jobInfo.itemNo || "—"}</Text>
            </View>
            <View style={s.jobInfoLine}>
              <Text style={s.jobInfoBold}>Date:</Text>
              <Text>{dateText}</Text>
            </View>
            {jobInfo.customer ? (
              <View style={s.jobInfoLine}>
                <Text style={s.jobInfoBold}>Customer:</Text>
                <Text>{jobInfo.customer}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {cadImages?.length > 0 && (
          <View style={s.cadSection} wrap={false}>
            <Text style={s.imageColLabel}>CAD Render{cadImages.length > 1 ? "s" : ""}</Text>
            <View style={s.imageGridFull}>
              {cadImages.map((img, i) => (
                <Image key={i} src={img} style={s.imageThumbFull} />
              ))}
            </View>
          </View>
        )}

        {turntableLink && !isOwnAppLink(turntableLink) ? (
          <Text style={{ fontSize: 8, marginBottom: 10 }}>3D render / turntable: {turntableLink}</Text>
        ) : null}

        <View style={s.specStrip} wrap={false}>
          <View style={s.specCellFirst}>
            <Text style={s.specLabel}>Primary metal</Text>
            <Text style={s.specValue}>
              {primaryAlloy ? `${primaryAlloy.short} · ${fmt(parseFloat(primaryGramWt) || 0, 2)}g` : "—"}
            </Text>
          </View>
          <View style={s.specCell}>
            <Text style={s.specLabel}>Secondary metal</Text>
            <Text style={s.specValue}>
              {secondaryAlloy && (parseFloat(secondaryGramWt) || 0) > 0
                ? `${secondaryAlloy.short} · ${fmt(parseFloat(secondaryGramWt) || 0, 2)}g`
                : "—"}
            </Text>
          </View>
          <View style={s.specCell}>
            <Text style={s.specLabel}>Item size</Text>
            <Text style={s.specValue}>{jobInfo.itemSize || "—"}</Text>
          </View>
        </View>

        <Text style={s.sectionLabel}>Stone Schedule</Text>
        <View style={s.tableHeaderRow} fixed>
          <Text style={[s.th, { width: "6%" }]}>Sr.No</Text>
          <Text style={[s.th, { width: "12%" }]}>Type</Text>
          <Text style={[s.th, { width: "30%" }]}>Shape / Size</Text>
          <Text style={[s.th, { width: "10%", textAlign: "right" }]}>Qty</Text>
          <Text style={[s.th, { width: "14%", textAlign: "right" }]}>Total Ct</Text>
          {showPrices && <Text style={[s.th, { width: "14%", textAlign: "right" }]}>$/Ct</Text>}
          {showPrices && <Text style={[s.th, { width: "14%", textAlign: "right" }]}>$ Total</Text>}
        </View>
        {rowsWithCalcs.map(({ r, c }, idx) => (
          <View key={idx} style={[s.tr, idx % 2 ? s.trAlt : {}]} wrap={false}>
            <Text style={[s.td, { width: "6%" }]}>{idx + 1}</Text>
            <Text style={[s.td, { width: "12%" }]}>{(r.mode || "natural") === "lgd" ? "Lab grown" : r.stoneTypeSel || "Mined"}</Text>
            <Text style={[s.td, { width: "30%" }]}>{shapeSizeText(c)}</Text>
            <Text style={[s.tdR, { width: "10%" }]}>{r.pcs}</Text>
            <Text style={[s.tdR, { width: "14%" }]}>{fmt(c.totalWt, 3)}</Text>
            {showPrices && <Text style={[s.tdR, { width: "14%" }]}>{fmtC(c.perCt)}</Text>}
            {showPrices && <Text style={[s.tdR, { width: "14%" }]}>{fmtC(c.total)}</Text>}
          </View>
        ))}

        {jobInfo.remarks ? (
          <View style={s.remarksBox} wrap={false}>
            <Text style={s.remarksLabel}>Remarks</Text>
            <Text style={s.remarksText}>{jobInfo.remarks}</Text>
          </View>
        ) : null}

        {showPrices ? (
          <View wrap={false}>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>Casting</Text>
                <Text style={s.totalsValue}>{fmtC(casting)}</Text>
              </View>
            </View>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>Labor</Text>
                <Text style={s.totalsValue}>{fmtC(labor)}</Text>
              </View>
            </View>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>CAD ({jobInfo.cadType})</Text>
                <Text style={s.totalsValue}>{fmtC(cadFee)}</Text>
              </View>
            </View>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>Diamonds</Text>
                <Text style={s.totalsValue}>{fmtC(totals.diamondTotal)}</Text>
              </View>
            </View>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>Setting</Text>
                <Text style={s.totalsValue}>{fmtC(totals.settingTotal)}</Text>
              </View>
            </View>
            <View style={s.totalsRow}>
              <View style={s.totalsLine}>
                <Text style={s.totalsLabel}>With {(locInfo.duty * 100).toFixed(0)}% duty (USD)</Text>
                <Text style={s.totalsValue}>{fmtC(totalWithDutyUSD)}</Text>
              </View>
            </View>
            {hasOverride && (
              <View style={s.totalsRow}>
                <View style={s.totalsLine}>
                  <Text style={s.totalsLabelMuted}>Calculated ({locInfo.currency})</Text>
                  <Text style={[s.totalsValue, { color: MUTED, fontStyle: "italic" }]}>
                    {fmtL(totalWithDutyLocal, locInfo.currency)}
                  </Text>
                </View>
              </View>
            )}
            <View style={s.totalsRow}>
              <View style={s.grandTotalBlock}>
                <Text style={s.grandTotalLabel}>
                  {locInfo.code} total ({locInfo.currency}, fx {fmt(fxRate, 3)})
                </Text>
                <Text style={s.grandTotalValue}>{fmtL(effectiveTotalLocal, locInfo.currency)}</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={s.bigPriceBlock} wrap={false}>
            <Text style={s.bigPriceLabel}>Total ({locInfo.currency})</Text>
            <Text style={s.bigPriceValue}>{fmtL(effectiveTotalLocal, locInfo.currency)}</Text>
          </View>
        )}

        <View style={s.fixedFooter} fixed>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
