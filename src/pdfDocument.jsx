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

  // Header: title on the left, logo prominently top-right (highlighted
  // box) with job info stacked underneath it.
  letterhead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: `1.5pt solid ${ROSE}`,
    paddingBottom: 10,
    marginBottom: 14,
  },
  titleBlock: { justifyContent: "center" },
  tagline: { fontSize: 7, letterSpacing: 1, textTransform: "uppercase", color: MUTED },
  quoteTitle: { fontSize: 19, fontFamily: "Times-Bold", marginTop: 2 },
  logoHighlightBox: {
    border: `1pt solid ${ROSE}`,
    borderRadius: 5,
    padding: 6,
    backgroundColor: TINT,
    alignItems: "center",
  },
  jobInfoCol: { alignItems: "flex-start" },
  jobInfoLine: { fontSize: 8.5, color: MUTED, marginBottom: 2, flexDirection: "row", gap: 3, justifyContent: "flex-start" },
  jobInfoBold: { color: INK, fontWeight: 700 },
  stageBadge: { fontSize: 8.5, color: MUTED, marginLeft: 4 },

  // CAD render: the hero image, sized to roughly half the page.
  cadSection: { marginBottom: 10 },
  sectionLabel: { fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ROSE, marginBottom: 5 },
  cadHero: {
    width: "100%",
    height: 380,
    objectFit: "contain",
    border: `0.75pt solid ${HAIRLINE}`,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  cadExtrasRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  cadExtraThumb: { width: 80, height: 62, objectFit: "contain", border: `0.5pt solid ${HAIRLINE}`, borderRadius: 3 },

  // Turntable link, styled as a small distinct pill between the CAD
  // image and the stone schedule.
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: TINT,
    border: `0.5pt solid ${ROSE}`,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  linkPillLabel: { fontSize: 7.5, fontWeight: 700, color: ROSE, textTransform: "uppercase", letterSpacing: 0.4 },
  linkPillText: { fontSize: 8, color: INK },

  specStrip: { flexDirection: "row", border: `0.5pt solid ${HAIRLINE}`, borderRadius: 4, marginBottom: 14 },
  specCell: { flex: 1, padding: 8, borderLeft: `0.5pt solid ${HAIRLINE}` },
  specCellFirst: { flex: 1, padding: 8 },
  specLabel: { fontSize: 7, textTransform: "uppercase", color: MUTED, marginBottom: 2 },
  specValue: { fontSize: 9, fontWeight: 700 },

  // Stone schedule -- styled like a packing list: clean, tight rows,
  // strong header bar.
  tableHeaderRow: { flexDirection: "row", backgroundColor: ROSE },
  th: { color: "#fff", fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", padding: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5pt solid ${HAIRLINE}` },
  trAlt: { backgroundColor: TINT },
  td: { fontSize: 8, padding: 4 },
  tdR: { fontSize: 8, padding: 4, textAlign: "right" },

  // Reference images: uniform square tiles, fixed pixel size (not
  // percentage-based) for predictable, non-spilling layout -- 3 per row.
  refImagesSection: { marginTop: 16, marginBottom: 14 },
  refImagesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  refImageTile: {
    width: 160,
    height: 160,
    objectFit: "contain",
    border: `0.75pt solid ${HAIRLINE}`,
    borderRadius: 4,
    backgroundColor: "#fff",
  },

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

// Reference-image collage: one featured tile + supporting tiles, rather
// than a uniform row of equal thumbnails. Layout adapts to how many
// images there actually are (1, 2, 3, or 4+).
function ReferenceImages({ images }) {
  if (!images || images.length === 0) return null;

  return (
    <View style={s.refImagesSection}>
      <Text style={s.sectionLabel}>
        Reference Image{images.length > 1 ? `s (${images.length})` : ""}
      </Text>
      <View style={s.refImagesGrid}>
        {images.map((img, i) => (
          <Image key={i} src={img} style={s.refImageTile} />
        ))}
      </View>
    </View>
  );
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
  clientRefImages,
  turntableLink,
  quoteStage,
  hasOverride,
  effectiveTotalLocal,
  logoBlack,
  printDate,
}) {
  const showPrices = variant === "full";
  const dateText = printDate ? new Date(printDate).toLocaleDateString() : new Date().toLocaleDateString();
  const showLink = turntableLink && !isOwnAppLink(turntableLink);

  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        {/* ---- Header: logo+job info grouped on the left, title+slogan on the right ---- */}
        <View style={s.letterhead}>
          <View style={{ flex: 1.4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {logoBlack && <Image src={logoBlack} style={{ width: 22, height: 17 }} />}
              <Text style={s.tagline}>World Shiner — Fine Jewelry Manufacturing</Text>
            </View>
            <Text style={s.quoteTitle}>{showPrices ? "Quotation" : "Price Summary"}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <View style={s.jobInfoCol}>
              <View style={s.jobInfoLine}>
                <Text style={s.jobInfoBold}>Job:</Text>
                <Text>{jobInfo.jobNo || "—"}</Text>
                {quoteStage ? <Text style={s.stageBadge}>{quoteStage}</Text> : null}
              </View>
              {jobInfo.itemNo ? (
                <View style={s.jobInfoLine}>
                  <Text style={s.jobInfoBold}>Item:</Text>
                  <Text>{jobInfo.itemNo}</Text>
                </View>
              ) : null}
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
        </View>

        {/* ---- CAD render: the hero image, ~half the page ---- */}
        {cadImages?.length > 0 && (
          <View style={s.cadSection} wrap={false}>
            <Text style={s.sectionLabel}>CAD Render</Text>
            <Image src={cadImages[0]} style={s.cadHero} />
            {cadImages.length > 1 && (
              <View style={s.cadExtrasRow}>
                {cadImages.slice(1, 6).map((img, i) => (
                  <Image key={i} src={img} style={s.cadExtraThumb} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ---- Turntable / 3D render link, between CAD and stone schedule ---- */}
        {showLink && (
          <View style={s.linkPill}>
            <Text style={s.linkPillLabel}>3D Render</Text>
            <Text style={s.linkPillText}>{turntableLink}</Text>
          </View>
        )}

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

        {/* ---- Stone schedule, styled as a packing list ---- */}
        <Text style={s.sectionLabel}>Stone Schedule</Text>
        <View style={s.tableHeaderRow}>
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

        {/* ---- Reference images, after the total ---- */}
        <ReferenceImages images={clientRefImages} />

        {jobInfo.remarks ? (
          <View style={s.remarksBox} wrap={false}>
            <Text style={s.remarksLabel}>Remarks</Text>
            <Text style={s.remarksText}>{jobInfo.remarks}</Text>
          </View>
        ) : null}

        <View style={s.fixedFooter} fixed>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
