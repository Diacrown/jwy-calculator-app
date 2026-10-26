import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

// Purchase Order PDF -- same field layout as the existing PO form (PO Number /
// Order Qty / Order Date / Due Date ... Remarks, then the main CAD image, then
// the reference image(s)), dressed in the Made with Love house style.
// Data comes from mapQuoteToPo() in poExport.js.

const ROSE = "#9C4A63";
const ROSE_DEEP = "#6F2F45";
const INK = "#241B1E";
const MUTED = "#7A6870";
const HAIRLINE = "#E8D9DE";
const TINT = "#FBF5F7";
const MARKER = "#FFF1A8";

// The logo PNG carries wide transparent margins, so it is shown through a
// fixed window and cropped to the artwork (objectFit: cover) -- same idea as
// the app's top banner. Adjust these two numbers to make it bigger/smaller.
const LOGO_W = 128;
const LOGO_H = 56;

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 38, paddingHorizontal: 30, fontFamily: "Helvetica", fontSize: 9, color: INK, backgroundColor: "#FFFFFF" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, height: 7, backgroundColor: ROSE },
  topBarAccent: { position: "absolute", top: 7, left: 0, width: 120, height: 2, backgroundColor: ROSE_DEEP },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: `1.25pt solid ${ROSE}`, marginBottom: 9 },
  logoWindow: { width: LOGO_W, height: LOGO_H, overflow: "hidden" },
  logoImg: { width: LOGO_W, height: LOGO_H, objectFit: "cover", objectPosition: "center" },
  logoWindowSm: { width: 92, height: 40, overflow: "hidden" },
  logoImgSm: { width: 92, height: 40, objectFit: "cover", objectPosition: "center" },
  headRight: { alignItems: "flex-end" },
  tagline: { fontSize: 7, letterSpacing: 2.2, textTransform: "uppercase", color: MUTED },
  poTitle: { fontSize: 25, fontFamily: "Times-Bold", color: ROSE_DEEP, marginTop: 2 },
  poSub: { fontSize: 8, color: MUTED, marginTop: 2 },

  grid: { flexShrink: 0, border: `0.75pt solid ${HAIRLINE}`, borderRadius: 4, overflow: "hidden" },
  row: { flexShrink: 0, flexDirection: "row", borderTop: `0.75pt solid ${HAIRLINE}` },
  rowFirst: { flexShrink: 0, flexDirection: "row", backgroundColor: TINT },
  cell: { flexShrink: 0, width: "25%", paddingVertical: 6, paddingHorizontal: 9, borderLeft: `0.75pt solid ${HAIRLINE}` },
  cellFirst: { flexShrink: 0, width: "25%", paddingVertical: 6, paddingHorizontal: 9 },
  label: { fontSize: 6.3, letterSpacing: 0.9, textTransform: "uppercase", color: ROSE, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  value: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, lineHeight: 1.25 },
  valueBig: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK },
  empty: { fontSize: 10, color: "#C9BAC0" },
  stoneLine: { flexShrink: 0, fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK, lineHeight: 1.3 },
  stoneQuality: { flexShrink: 0, fontSize: 8.5, color: MUTED, lineHeight: 1.3 },
  remarksText: { fontSize: 10, color: INK, lineHeight: 1.45, backgroundColor: MARKER, marginTop: 2 },

  imageSection: { flexGrow: 1, flexShrink: 1, flexBasis: 0, marginTop: 8, minHeight: 150 },
  sectionLabel: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  sectionLabelText: { fontSize: 7.5, letterSpacing: 1.6, textTransform: "uppercase", color: ROSE, fontFamily: "Helvetica-Bold" },
  sectionRule: { flexGrow: 1, height: 0.75, backgroundColor: HAIRLINE, marginLeft: 8 },
  imageFrame: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, border: `0.75pt solid ${HAIRLINE}`, borderRadius: 4, backgroundColor: "#FFFFFF" },
  // Pinned to all four edges of the frame, so the picture always takes exactly
  // the space that is left on the page (whatever the form above needs).
  imageFill: { position: "absolute", top: 2, left: 2, right: 2, bottom: 2, objectFit: "contain", objectPosition: "center" },

  refArea: { flexGrow: 1, alignItems: "center", justifyContent: "flex-start" },
  refRow: { flexDirection: "row", justifyContent: "center", marginBottom: 8 },
  refTile: { border: `0.5pt solid ${HAIRLINE}`, backgroundColor: "#FFFFFF" },

  footer: { position: "absolute", bottom: 14, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTop: `0.5pt solid ${HAIRLINE}`, paddingTop: 5 },
  footerText: { fontSize: 7, color: MUTED, letterSpacing: 0.6 },
  footerBrand: { fontSize: 7.5, color: ROSE, fontFamily: "Times-Italic" },
});

// Page-1 layout: the CAD image section simply takes whatever height is left
// under the PO form (flex-grow), so the picture is always as large as the page
// allows -- more stone lines or a longer remark shrink it, a short form lets it
// grow -- and it can never spill onto page 2. objectFit keeps its proportions.

function Cell({ label, children, first, w }) {
  return (
    <View style={[first ? s.cellFirst : s.cell, w ? { width: w } : {}]}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

const Val = ({ v, big }) =>
  v ? <Text style={big ? s.valueBig : s.value}>{v}</Text> : <Text style={s.empty}>—</Text>;

// `logo` is either a plain image URL (shown through a cropping window, because
// the PNG has wide transparent margins) or { src, w, h } -- the logo already
// trimmed to its artwork by the app -- which is shown at its true proportions.
function LogoWindow({ logo, small }) {
  const boxH = small ? 36 : 50;
  if (!logo) return <View style={{ height: boxH }} />;
  if (typeof logo === "object" && logo.src && logo.w && logo.h) {
    const h = boxH;
    const w = Math.min(210, Math.round((h * logo.w) / logo.h));
    return (
      <View style={{ height: h, width: w }}>
        <Image src={logo.src} style={{ width: w, height: h, objectFit: "contain" }} />
      </View>
    );
  }
  const src = typeof logo === "string" ? logo : logo.src;
  return (
    <View style={small ? s.logoWindowSm : s.logoWindow}>
      <Image src={src} style={small ? s.logoImgSm : s.logoImg} />
    </View>
  );
}

// ---- Reference-image layout ------------------------------------------------
// Every job's reference photos are different shapes (wide, tall, square), so
// instead of fixed slots the page is packed from the images' real proportions:
// all ways of splitting the images, in order, into rows are tried; in each row
// the images share one height and the row fills the page width; if the rows
// are too tall they are scaled down together. The arrangement that shows the
// most picture area wins.
const REF_PAGE_W = 595 - 60;
const REF_PAGE_H = 842 - 26 - 38 - 80 - 24 - 8; // page - paddings - header - label - footer clearance
const REF_GAP = 8;

function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

export function layoutReferenceImages(images, W = REF_PAGE_W, H = REF_PAGE_H, gap = REF_GAP) {
  const n = images.length;
  const asp = images.map((im) => (im.w > 0 && im.h > 0 ? im.w / im.h : 4 / 3));
  let best = null;
  // Every order of the images (at most 6 per page) x every way of cutting that
  // order into rows; the original order is tried first so it wins ties.
  for (const order of permutations([...Array(n).keys()])) {
    for (let mask = 0; mask < 1 << Math.max(0, n - 1); mask++) {
      const rows = [[order[0]]];
      for (let i = 1; i < n; i++) {
        if (mask & (1 << (i - 1))) rows.push([order[i]]);
        else rows[rows.length - 1].push(order[i]);
      }
      const heights = rows.map((r) => (W - gap * (r.length - 1)) / r.reduce((a, i) => a + asp[i], 0));
      const gapsH = gap * (rows.length - 1);
      const sumH = heights.reduce((a, b) => a + b, 0);
      const scale = Math.min(1, (H - gapsH) / sumH);
      let area = 0;
      let minA = Infinity;
      let maxA = 0;
      const laid = rows.map((r, ri) => {
        const h = heights[ri] * scale;
        return {
          h,
          items: r.map((i) => {
            const a = asp[i] * h * h;
            area += a;
            minA = Math.min(minA, a);
            maxA = Math.max(maxA, a);
            return { idx: i, w: asp[i] * h, h };
          }),
        };
      });
      // Most picture area wins, with a mild preference for arrangements where
      // no image ends up a tiny thumbnail next to a huge one.
      const score = area * (0.6 + 0.4 * (maxA > 0 ? minA / maxA : 1));
      if (!best || score > best.score * 1.01) best = { score, rows: laid };
    }
  }
  return best ? best.rows : [];
}

// Small version of the brand logo for the footer (falls back to the
// "Made with Love" wording when the logo couldn't be loaded).
function FooterBrand({ logo }) {
  if (logo && typeof logo === "object" && logo.src && logo.w && logo.h) {
    const h = 15;
    const w = Math.min(70, Math.round((h * logo.w) / logo.h));
    return <Image src={logo.src} style={{ width: w, height: h, objectFit: "contain" }} />;
  }
  return <Text style={s.footerBrand}>Made with Love</Text>;
}

function Footer({ data, logo }) {
  return (
    <View style={s.footer} fixed>
      <FooterBrand logo={logo} />
      <Text style={s.footerText}>PO {data.poNumber || "—"}{data.ourStyle ? `  ·  ${data.ourStyle}` : ""}</Text>
      <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

const SectionLabel = ({ children }) => (
  <View style={s.sectionLabel}>
    <Text style={s.sectionLabelText}>{children}</Text>
    <View style={s.sectionRule} />
  </View>
);

export function PurchaseOrderPdf({ data, logo, cadImage, extraImages = [] }) {
  const d = data || {};
  const refs = extraImages.filter((x) => x && x.src);
  // Reference images go 6 to a page (more than that continue on further pages).
  const refPages = [];
  for (let i = 0; i < refs.length; i += 6) refPages.push(refs.slice(i, i + 6));

  return (
    <Document title={`PO ${d.poNumber || ""}`.trim()} author="Made with Love" subject="Purchase Order">
      <Page size="A4" style={s.page}>
        <View style={s.topBar} fixed />
        <View style={s.topBarAccent} fixed />

        {/* ---- Header ---- */}
        <View style={s.header}>
          <LogoWindow logo={logo} />
          <View style={s.headRight}>
            <Text style={s.tagline}>Purchase Order</Text>
            <Text style={s.poTitle}>No. {d.poNumber || "—"}</Text>
            {d.ourStyle ? <Text style={s.poSub}>Style {d.ourStyle}</Text> : null}
          </View>
        </View>

        {/* ---- PO form ---- */}
        <View style={s.grid}>
          <View style={s.rowFirst}>
            <Cell label="PO Number" first><Val v={d.poNumber} big /></Cell>
            <Cell label="Order Qty"><Val v={d.orderQty} big /></Cell>
            <Cell label="Order Date"><Val v={d.orderDate} big /></Cell>
            <Cell label="Due Date"><Val v={d.dueDate} big /></Cell>
          </View>
          <View style={s.row}>
            <Cell label="Customer" first><Val v={d.customer} /></Cell>
            <Cell label="Vendor"><Val v={d.vendor} /></Cell>
            <Cell label="Our Style #"><Val v={d.ourStyle} /></Cell>
            <Cell label="Your Style #"><Val v={d.yourStyle} /></Cell>
          </View>
          <View style={s.row}>
            <Cell label="Item Type" first><Val v={d.itemType} /></Cell>
            <Cell label="Item Size"><Val v={d.itemSize} /></Cell>
            <Cell label="Metal Type (Alloy Type)"><Val v={d.metal} /></Cell>
            <Cell label="Rhodium"><Val v={d.rhodium} /></Cell>
          </View>
          <View style={s.row}>
            <Cell label="Findings" first w="75%"><Val v={d.findings} /></Cell>
            <Cell label="Set By"><Val v={d.setBy} /></Cell>
          </View>
          <View style={s.row}>
            <Cell label="Stone Type" first><Val v={d.stoneType} /></Cell>
            <Cell label="Supplied By"><Val v={d.suppliedBy} /></Cell>
            <Cell label="Stone Details" w="50%">
              {d.stoneLines && d.stoneLines.length > 0 ? (
                d.stoneLines.map((l, i) => (
                  <Text key={i} style={[s.stoneLine, { marginBottom: 3 }]}>
                    {l.text}
                    {l.quality ? <Text style={s.stoneQuality}>{"\n" + l.quality}</Text> : null}
                  </Text>
                ))
              ) : (
                <Text style={s.empty}>{d.isPlain ? `${d.stoneType || "Plain"} — no stones` : "—"}</Text>
              )}
            </Cell>
          </View>
          <View style={s.row}>
            <Cell label="Stamp Logo" first><Val v={d.stampLogo} /></Cell>
            <Cell label="Stamp Metal"><Val v={d.stampMetal} /></Cell>
            <Cell label="Stamp Other"><Val v={d.stampOther} /></Cell>
            <Cell label="Stamp Location"><Val v={d.stampLoc} /></Cell>
          </View>
          <View style={s.row}>
            <Cell label="Remarks" first w="100%">
              {d.remarks ? <Text style={s.remarksText}>{d.remarks}</Text> : <Text style={s.empty}>—</Text>}
            </Cell>
          </View>
        </View>

        {/* ---- Main CAD image ---- */}
        {cadImage ? (
          <View style={s.imageSection} wrap={false}>
            <SectionLabel>CAD Render</SectionLabel>
            <View style={s.imageFrame}>
              <Image src={cadImage} style={s.imageFill} />
            </View>
          </View>
        ) : null}

        <Footer data={d} logo={logo} />
      </Page>

      {/* ---- Reference image(s) ---- */}
      {refPages.map((chunk, pi) => {
        const rows = layoutReferenceImages(chunk);
        return (
          <Page key={pi} size="A4" style={s.page}>
            <View style={s.topBar} fixed />
            <View style={s.topBarAccent} fixed />
            <View style={s.header}>
              <LogoWindow logo={logo} />
              <View style={s.headRight}>
                <Text style={s.tagline}>Purchase Order · Reference</Text>
                <Text style={[s.poTitle, { fontSize: 18 }]}>No. {d.poNumber || "—"}</Text>
              </View>
            </View>
            <SectionLabel>Reference Image{refs.length > 1 ? "s" : ""}</SectionLabel>
            <View style={s.refArea}>
              {rows.map((row, ri) => (
                <View key={ri} style={s.refRow} wrap={false}>
                  {row.items.map((it, k) => (
                    <View key={it.idx} style={[s.refTile, { width: it.w, height: it.h, marginLeft: k ? REF_GAP : 0 }]}>
                      <Image src={chunk[it.idx].src} style={{ width: it.w - 1, height: it.h - 1, objectFit: "contain" }} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
            <Footer data={d} logo={logo} />
          </Page>
        );
      })}
    </Document>
  );
}
