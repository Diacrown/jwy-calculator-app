import { useState, useEffect, useCallback, useMemo } from "react";
import { DEFAULT_DATA } from "./defaultData.js";
import { FANCY_GRADE_ORDER } from "./fancyPrices.js";

// Hidden developer console -- the one place the calculator's price / rate tables
// are changed. It is not linked from anywhere: open the site's address with
// "#/developer" on the end. Nothing here can be changed without the developer
// token; the token is checked by the server (netlify/functions/dev-admin.mjs) on
// every request, and is kept only in this browser tab's session storage.

const NATURAL_GRADES = ["TW VS", "TW SI1", "TW SI2", "TW SI3", "TW I1", "WH SI", "IJ SI2-I1"];
const CAD_LEVELS = ["None", "Simple", "Medium", "Complex", "Advanced"];
const ALLOY_METALS = ["WX", "AY", "AU", "PT", "PD", "AG"];
const METAL_LABEL = { AU: "Gold", PT: "Platinum", PD: "Palladium", AG: "Silver" };
const ENDPOINT = "/.netlify/functions/dev-admin";
const TOKEN_KEY = "jwyDevToken";

const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };

async function api(action, body = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": getToken() },
    body: JSON.stringify({ action, ...body }),
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const show = (v) => (v === null || v === undefined ? "" : String(v));

/* ---------- table definitions: how each override table is shown / saved ---------- */
// toRows(value) -> editable rows (strings);  fromRows(rows) -> value to send
const TABLE_DEFS = {
  alloys: {
    title: "Alloys",
    note: "Renaming a short name affects saved quotes that used it. Order here is the order of the dropdown.",
    columns: [
      { key: "name", label: "Alloy name", w: 230 },
      { key: "short", label: "Short name", w: 110 },
      { key: "sg", label: "SG", num: true },
      { key: "purity", label: "Purity", num: true },
      { key: "metal", label: "Metal", options: ALLOY_METALS },
      { key: "castingGm", label: "Casting/gm", num: true },
      { key: "minGms", label: "Min gms", num: true },
      { key: "surchargeGm", label: "Surcharge/gm", num: true },
    ],
    blank: { name: "", short: "", sg: "", purity: "", metal: "AU", castingGm: "10", minGms: "7", surchargeGm: "5" },
    toRows: (v) => v.map((r) => mapStr(r)),
    fromRows: (rows) => rows,
  },
  locations: {
    title: "Locations & duty",
    note: "Duty is a fraction: 0.05 means 5%. The currency must exist in the Currency table.",
    columns: [
      { key: "code", label: "Location code", w: 150 },
      { key: "currency", label: "Currency (3 letters)", w: 120 },
      { key: "duty", label: "Duty (0.05 = 5%)", num: true },
    ],
    blank: { code: "", currency: "USD", duty: "0" },
    toRows: (v) => v.map((r) => mapStr(r)),
    fromRows: (rows) => rows,
  },
  settingTiers: {
    title: "Setting tiers",
    note: "Rows must go from smallest to largest. The last row should be a large catch-all (e.g. 99).",
    columns: [
      { key: "uptoCt", label: "Up to ct (per piece)", num: true },
      { key: "rate", label: "Rate", num: true },
      { key: "type", label: "Type", options: ["PER PC", "PER CT"] },
    ],
    blank: { uptoCt: "", rate: "", type: "PER PC" },
    toRows: (v) => v.map((r) => mapStr(r)),
    fromRows: (rows) => rows,
  },
  naturalPrices: {
    title: "Natural (mined) round prices - $/ct",
    note: "One row per size group (R00, R02 ...). Leave a grade empty if it is not sold at that size. Size groups already used by the calculator cannot be deleted.",
    columns: [{ key: "code", label: "Size group", w: 90 }, ...NATURAL_GRADES.map((g) => ({ key: g, label: g, num: true }))],
    blank: { code: "" },
    toRows: (v) => Object.entries(v).map(([code, grid]) => ({ code, ...mapStr(grid) })),
    fromRows: (rows) => Object.fromEntries(rows.map((r) => [String(r.code).trim(), Object.fromEntries(NATURAL_GRADES.filter((g) => show(r[g]).trim() !== "").map((g) => [g, r[g]]))])),
    protectedKeys: Object.keys(DEFAULT_DATA.naturalPrices),
  },
  fancyPrices: {
    title: "Fancy-shape prices - $/ct",
    note: "One row per size code (e.g. PRN2.0M, OVL040W). Leave a grade empty if it is not priced.",
    columns: [{ key: "code", label: "Size code", w: 120 }, ...FANCY_GRADE_ORDER.map((g) => ({ key: g, label: g, num: true }))],
    blank: { code: "" },
    toRows: (v) => Object.entries(v).map(([code, grid]) => ({ code, ...mapStr(grid) })),
    fromRows: (rows) => Object.fromEntries(rows.map((r) => [String(r.code).trim(), Object.fromEntries(FANCY_GRADE_ORDER.filter((g) => show(r[g]).trim() !== "").map((g) => [g, r[g]]))])),
  },
  labGrownPrices: {
    title: "Lab-grown prices - $/ct",
    note: "One row per shape and carat band. Leave a price empty if that grade is not offered in the band.",
    columns: [
      { key: "shape", label: "Shape", w: 130 },
      { key: "minCt", label: "Min ct", num: true },
      { key: "maxCt", label: "Max ct", num: true },
      { key: "dvvs2", label: "D/VVS2", num: true },
      { key: "dvs1", label: "D/VS1", num: true },
      { key: "nonCert", label: "Non-cert", num: true },
    ],
    blank: { shape: "", minCt: "", maxCt: "", dvvs2: "", dvs1: "", nonCert: "" },
    toRows: (v) => v.map((r) => mapStr(r)),
    fromRows: (rows) => rows,
  },
};
function mapStr(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, show(v)])); }

/* ---------- styles ---------- */
const C = { ink: "#2A1F24", muted: "#7A6A70", line: "#E4D9DC", bg: "#FAF6F7", card: "#FFFFFF", accent: "#7A2342", ok: "#2F7D4F", warn: "#B5651D", bad: "#B3261E" };
const S = {
  page: { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: "20px 16px 60px" },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  card: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, marginBottom: 14 },
  h1: { fontSize: 20, margin: 0 },
  h2: { fontSize: 16, margin: "0 0 4px" },
  note: { fontSize: 12.5, color: C.muted, margin: "0 0 10px", lineHeight: 1.45 },
  tabs: { display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0" },
  tab: (on) => ({ padding: "6px 12px", borderRadius: 16, border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : "#fff", color: on ? "#fff" : C.ink, cursor: "pointer", fontSize: 13 }),
  btn: (kind) => ({ padding: "7px 14px", borderRadius: 7, border: `1px solid ${kind === "primary" ? C.accent : C.line}`, background: kind === "primary" ? C.accent : kind === "danger" ? "#fff" : "#fff", color: kind === "primary" ? "#fff" : kind === "danger" ? C.bad : C.ink, cursor: "pointer", fontSize: 13, marginRight: 8 }),
  input: { padding: "5px 6px", border: `1px solid ${C.line}`, borderRadius: 5, fontSize: 13, width: "100%", boxSizing: "border-box", background: "#fff", color: C.ink },
  th: { textAlign: "left", fontSize: 11.5, color: C.muted, fontWeight: 600, padding: "4px 4px", whiteSpace: "nowrap" },
  td: { padding: "2px 3px" },
  msg: (kind) => ({ padding: "8px 12px", borderRadius: 7, fontSize: 13, margin: "10px 0", background: kind === "ok" ? "#E6F3EA" : "#FBE8E6", color: kind === "ok" ? C.ok : C.bad }),
  pill: (kind) => ({ display: "inline-block", fontSize: 11.5, padding: "2px 8px", borderRadius: 10, background: kind === "dev" ? "#F5E3D0" : "#EDE7E9", color: kind === "dev" ? C.warn : C.muted, marginLeft: 8 }),
};

/* ---------- reusable grid ---------- */
function Grid({ columns, rows, setRows, blank, protectedKeys = [] }) {
  const set = (i, key, val) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const c = rows.slice(); [c[i], c[j]] = [c[j], c[i]]; setRows(c); };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} style={S.th}>{c.label}</th>)}
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const locked = protectedKeys.includes(String(r.code));
            return (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={{ ...S.td, minWidth: c.w || 78 }}>
                    {c.options ? (
                      <select style={S.input} value={r[c.key] ?? ""} onChange={(e) => set(i, c.key, e.target.value)}>
                        {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        style={S.input}
                        value={r[c.key] ?? ""}
                        inputMode={c.num ? "decimal" : undefined}
                        disabled={locked && c.key === "code"}
                        onChange={(e) => set(i, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                  <button type="button" style={S.btn()} onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button type="button" style={S.btn()} onClick={() => move(i, 1)} title="Move down">↓</button>
                  {!locked && <button type="button" style={S.btn("danger")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Delete</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" style={{ ...S.btn(), marginTop: 8 }} onClick={() => setRows([...rows, { ...blank }])}>+ Add row</button>
    </div>
  );
}

/* ---------- editor shell: save / reset for one table ---------- */
function Editor({ title, note, override, onSave, onReset, children, canSave = true }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const run = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ kind: "ok", text: okText }); } catch (e) { setMsg({ kind: "bad", text: e.message }); }
    setBusy(false); setConfirmReset(false);
  };
  return (
    <div style={S.card}>
      <h2 style={S.h2}>
        {title}
        <span style={S.pill(override ? "dev" : "built-in")}>{override ? `Changed ${new Date(override.updatedAt).toLocaleString()}` : "Built-in values"}</span>
      </h2>
      {note && <p style={S.note}>{note}</p>}
      {children}
      {msg && <div style={S.msg(msg.kind)}>{msg.text}</div>}
      <div style={{ marginTop: 12 }}>
        <button type="button" style={S.btn("primary")} disabled={busy || !canSave} onClick={() => run(onSave, "Saved. The calculator picks it up within 5 minutes (or on its next Sync).")}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {override && !confirmReset && <button type="button" style={S.btn()} disabled={busy} onClick={() => setConfirmReset(true)}>Reset to built-in</button>}
        {override && confirmReset && (
          <>
            <span style={{ fontSize: 13, marginRight: 8 }}>Throw away the changes?</span>
            <button type="button" style={S.btn("danger")} disabled={busy} onClick={() => run(onReset, "Reset. Built-in values apply again.")}>Yes, reset</button>
            <button type="button" style={S.btn()} onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- generic table tab ---------- */
function TableTab({ name, override, save, reset }) {
  const def = TABLE_DEFS[name];
  const current = override ? override.value : DEFAULT_DATA[name];
  const [rows, setRows] = useState(() => def.toRows(clone(current)));
  useEffect(() => { setRows(def.toRows(clone(current))); }, [override && override.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Editor title={def.title} note={def.note} override={override} onSave={() => save(name, def.fromRows(rows))} onReset={() => reset(name)}>
      <Grid columns={def.columns} rows={rows} setRows={setRows} blank={def.blank} protectedKeys={def.protectedKeys} />
    </Editor>
  );
}

/* ---------- special tabs ---------- */
function MetalsTab({ overrides, save, reset, pmOverride, setPmOverride }) {
  const override = overrides.metalPolicy;
  const current = override ? override.value : DEFAULT_DATA.metalPolicy;
  const [policy, setPolicy] = useState(() => mapPolicy(current));
  const [pm, setPm] = useState({ AU: "", PT: "", PD: "", AG: "" });
  const [pmMsg, setPmMsg] = useState(null);
  const [live, setLive] = useState(null);
  useEffect(() => { setPolicy(mapPolicy(current)); }, [override && override.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const setP = (code, k, v) => setPolicy({ ...policy, [code]: { ...policy[code], [k]: v } });

  const pmCall = async (action, body) => {
    setPmMsg(null);
    try { const r = await api(action, body); setPmOverride(r.pmOverride || {}); setPm({ AU: "", PT: "", PD: "", AG: "" }); setPmMsg({ kind: "ok", text: action === "pmSet" ? "PM rates set." : "Typed PM rates removed - the automatic rates apply again." }); }
    catch (e) { setPmMsg({ kind: "bad", text: e.message }); }
  };
  const checkLive = async () => {
    try { const r = await fetch("/.netlify/functions/metal-rates", { cache: "no-store" }); setLive(await r.json()); } catch (e) { setLive({ error: e.message }); }
  };

  return (
    <>
      <Editor
        title="Metal pricing policy (wastage & spot surcharge)"
        note="Business settings applied on top of the live market rate. Net rate/gm = PM rate per oz ÷ 31.1035 × wastage."
        override={override}
        onSave={() => save("metalPolicy", policy)}
        onReset={() => reset("metalPolicy")}
      >
        <table style={{ borderCollapse: "collapse" }}>
          <thead><tr><th style={S.th}>Metal</th><th style={S.th}>Wastage</th><th style={S.th}>Spot surcharge</th></tr></thead>
          <tbody>
            {Object.keys(METAL_LABEL).map((code) => (
              <tr key={code}>
                <td style={S.td}>{METAL_LABEL[code]} ({code})</td>
                <td style={S.td}><input style={S.input} value={policy[code].wastage} onChange={(e) => setP(code, "wastage", e.target.value)} /></td>
                <td style={S.td}><input style={S.input} value={policy[code].spotSurcharge} onChange={(e) => setP(code, "spotSurcharge", e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Editor>

      <div style={S.card}>
        <h2 style={S.h2}>PM rate - type the official figure</h2>
        <p style={S.note}>
          The calculator takes the live spot price automatically and records the PM rate at each London fix time. If you want the exact LBMA PM figure instead,
          type it here (USD per oz). Typed rates stay in force until you remove them.
        </p>
        <table style={{ borderCollapse: "collapse" }}>
          <thead><tr><th style={S.th}>Metal</th><th style={S.th}>PM rate / oz (USD)</th><th style={S.th}>Currently typed</th></tr></thead>
          <tbody>
            {Object.keys(METAL_LABEL).map((code) => (
              <tr key={code}>
                <td style={S.td}>{METAL_LABEL[code]} ({code})</td>
                <td style={S.td}><input style={S.input} inputMode="decimal" value={pm[code]} onChange={(e) => setPm({ ...pm, [code]: e.target.value })} /></td>
                <td style={{ ...S.td, fontSize: 12.5, color: C.muted }}>{pmOverride[code] ? `${pmOverride[code].price} (${pmOverride[code].label})` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pmMsg && <div style={S.msg(pmMsg.kind)}>{pmMsg.text}</div>}
        <div style={{ marginTop: 10 }}>
          <button type="button" style={S.btn("primary")} onClick={() => pmCall("pmSet", pm)}>Set PM rates</button>
          <button type="button" style={S.btn()} onClick={() => pmCall("pmClear")}>Remove typed PM rates</button>
          <button type="button" style={S.btn()} onClick={checkLive}>Show rates the calculator is getting</button>
        </div>
        {live && (
          <pre style={{ fontSize: 12, background: C.bg, padding: 10, borderRadius: 6, overflowX: "auto", marginTop: 10 }}>
            {live.rates
              ? Object.entries(live.rates).map(([c, r]) => `${c}  PM ${r.pmRateOz}  spot ${r.spotOz}  wastage ${r.wastage}  surcharge ${r.spotSurcharge}  [${r.pmSource}]  ${r.asOf}`).join("\n") + `\nsource: ${live.source}`
              : JSON.stringify(live)}
          </pre>
        )}
      </div>
    </>
  );
}
function mapPolicy(p) { return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, mapStr(v)])); }

function CurrencyTab({ overrides, save, reset }) {
  const override = overrides.currency;
  const current = override ? override.value : { mode: DEFAULT_DATA.currencyMode, markup: DEFAULT_DATA.currencyMarkup, rates: DEFAULT_DATA.currencyRates };
  const toState = (c) => ({ mode: c.mode, markup: String(c.markup), rows: Object.entries(c.rates).filter(([k]) => k !== "USD").map(([code, rate]) => ({ code, rate: String(rate) })) });
  const [st, setSt] = useState(() => toState(current));
  useEffect(() => { setSt(toState(current)); }, [override && override.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const build = () => ({ mode: st.mode, markup: st.markup, rates: { USD: 1, ...Object.fromEntries(st.rows.map((r) => [String(r.code).trim().toUpperCase(), r.rate])) } });
  return (
    <Editor
      title="Currency"
      note='"Live" fetches daily exchange rates from a free feed (European Central Bank figures) and uses the rates below only if the feed is down. "Manual" always uses the rates below. The markup is multiplied onto every non-USD rate.'
      override={override}
      onSave={() => save("currency", build())}
      onReset={() => reset("currency")}
    >
      <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>Rate source<br />
          <select style={{ ...S.input, width: 180 }} value={st.mode} onChange={(e) => setSt({ ...st, mode: e.target.value })}>
            <option value="live">Live (automatic)</option>
            <option value="manual">Manual (rates below)</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>Markup (1.05 = +5%)<br />
          <input style={{ ...S.input, width: 120 }} value={st.markup} onChange={(e) => setSt({ ...st, markup: e.target.value })} />
        </label>
      </div>
      <Grid
        columns={[{ key: "code", label: "Currency (USD→)", w: 110 }, { key: "rate", label: "Units per 1 USD", num: true }]}
        rows={st.rows}
        setRows={(rows) => setSt({ ...st, rows })}
        blank={{ code: "", rate: "" }}
      />
    </Editor>
  );
}

function LaborTab({ overrides, save, reset }) {
  const override = overrides.labor;
  const current = override ? override.value : { laborPerGm: DEFAULT_DATA.laborPerGm, laborMinFlat: DEFAULT_DATA.laborMinFlat, cadFees: DEFAULT_DATA.cadFees };
  const toState = (c) => ({ laborPerGm: String(c.laborPerGm), laborMinFlat: String(c.laborMinFlat), cadFees: mapStr(c.cadFees) });
  const [st, setSt] = useState(() => toState(current));
  useEffect(() => { setSt(toState(current)); }, [override && override.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Editor title="Labor & CAD fees" note="Labor is charged per gram of metal, with a minimum flat amount. CAD fee depends on the CAD complexity chosen on the job." override={override} onSave={() => save("labor", st)} onReset={() => reset("labor")}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>Labor per gm ($)<br /><input style={{ ...S.input, width: 130 }} value={st.laborPerGm} onChange={(e) => setSt({ ...st, laborPerGm: e.target.value })} /></label>
        <label style={{ fontSize: 13 }}>Minimum labor ($)<br /><input style={{ ...S.input, width: 130 }} value={st.laborMinFlat} onChange={(e) => setSt({ ...st, laborMinFlat: e.target.value })} /></label>
        {CAD_LEVELS.map((l) => (
          <label key={l} style={{ fontSize: 13 }}>CAD: {l} ($)<br /><input style={{ ...S.input, width: 110 }} value={st.cadFees[l]} onChange={(e) => setSt({ ...st, cadFees: { ...st.cadFees, [l]: e.target.value } })} /></label>
        ))}
      </div>
    </Editor>
  );
}

function HistoryTab({ history, restore }) {
  const [msg, setMsg] = useState(null);
  return (
    <div style={S.card}>
      <h2 style={S.h2}>Change history</h2>
      <p style={S.note}>Every save, reset and restore is recorded. "Put back" returns that table to what it was before the change.</p>
      {msg && <div style={S.msg(msg.kind)}>{msg.text}</div>}
      {history.length === 0 && <p style={S.note}>No changes yet.</p>}
      {history.map((h) => (
        <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: `1px solid ${C.line}`, fontSize: 13 }}>
          <span>{new Date(h.at).toLocaleString()} - <b>{h.table}</b> ({h.action})</span>
          <button type="button" style={S.btn()} onClick={async () => { try { await restore(h.id); setMsg({ kind: "ok", text: "Put back." }); } catch (e) { setMsg({ kind: "bad", text: e.message }); } }}>Put back</button>
        </div>
      ))}
    </div>
  );
}

/* ---------- login ---------- */
function Login({ onIn }) {
  const [token, setTok] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    setToken(token.trim());
    try { await api("login"); onIn(); } catch (x) { setToken(""); setErr(x.message); }
    setBusy(false);
  };
  return (
    <div style={S.page}>
      <form onSubmit={go} style={{ ...S.card, maxWidth: 380, margin: "80px auto" }}>
        <h1 style={S.h1}>Developer console</h1>
        <p style={S.note}>Enter the developer token.</p>
        <input type="password" autoComplete="off" style={S.input} value={token} onChange={(e) => setTok(e.target.value)} placeholder="Token" autoFocus />
        {err && <div style={S.msg("bad")}>{err}</div>}
        <div style={{ marginTop: 12 }}><button type="submit" style={S.btn("primary")} disabled={busy || !token.trim()}>{busy ? "Checking…" : "Open"}</button></div>
      </form>
    </div>
  );
}

/* ---------- main ---------- */
const TABS = [
  ["metals", "Metals"], ["alloys", "Alloys"], ["currency", "Currency"], ["locations", "Locations"], ["labor", "Labor & CAD"],
  ["settingTiers", "Setting"], ["naturalPrices", "Natural"], ["fancyPrices", "Fancy"], ["labGrownPrices", "Lab grown"], ["history", "History"],
];

export default function DeveloperConsole() {
  const [authed, setAuthed] = useState(false);
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("metals");
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    try { setState(await api("load")); setLoadErr(""); }
    catch (e) { if (e.status === 401 || e.status === 429 || e.status === 503) { setToken(""); setAuthed(false); } setLoadErr(e.message); }
  }, []);

  useEffect(() => { if (getToken()) { api("login").then(() => { setAuthed(true); load(); }).catch(() => setToken("")); } }, [load]);

  const save = useCallback(async (table, value) => { await api("save", { table, value }); await load(); }, [load]);
  const reset = useCallback(async (table) => { await api("reset", { table }); await load(); }, [load]);
  const restore = useCallback(async (id) => { await api("restore", { id }); await load(); }, [load]);

  const overrides = useMemo(() => (state ? state.overrides : {}), [state]);

  if (!authed) return <Login onIn={() => { setAuthed(true); load(); }} />;
  if (!state) return <div style={S.page}><div style={S.wrap}>{loadErr ? <div style={S.msg("bad")}>{loadErr}</div> : "Loading…"}</div></div>;

  const common = { overrides, save, reset };
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={S.h1}>Developer console <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>data version {state.version}</span></h1>
          <span>
            <a href="#/" style={{ ...S.btn(), textDecoration: "none", display: "inline-block" }} onClick={() => { window.location.hash = ""; window.location.reload(); }}>Back to calculator</a>
            <button type="button" style={S.btn()} onClick={() => { setToken(""); setAuthed(false); setState(null); }}>Lock</button>
          </span>
        </div>
        <div style={S.tabs}>
          {TABS.map(([k, label]) => <button key={k} type="button" style={S.tab(tab === k)} onClick={() => setTab(k)}>{label}{overrides[k === "metals" ? "metalPolicy" : k === "labor" ? "labor" : k] ? " •" : ""}</button>)}
        </div>
        {loadErr && <div style={S.msg("bad")}>{loadErr}</div>}
        {tab === "metals" && <MetalsTab {...common} pmOverride={state.pmOverride || {}} setPmOverride={(pmOverride) => setState((s) => ({ ...s, pmOverride }))} />}
        {tab === "currency" && <CurrencyTab {...common} />}
        {tab === "labor" && <LaborTab {...common} />}
        {TABLE_DEFS[tab] && <TableTab key={tab} name={tab} override={overrides[tab]} save={save} reset={reset} />}
        {tab === "history" && <HistoryTab history={state.history || []} restore={restore} />}
        <p style={S.note}>• marks a table that has been changed from its built-in values.</p>
      </div>
    </div>
  );
}
