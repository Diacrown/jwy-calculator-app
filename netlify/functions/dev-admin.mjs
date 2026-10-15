import { getStore } from "@netlify/blobs";
import { authorize } from "./_auth.mjs";
import { TABLES, METAL_CODES, validateTable, readOverrides, defaultTable } from "./_appData.mjs";
import { londonNow } from "./_metalPolicy.mjs";

// Developer console back end. POST only, JSON body { action, ... }, header
// x-admin-token. Every request is authenticated here, on the server -- hiding
// the page in the browser is not what protects the data, this check is.
//
// Actions
//   login                      check the token only
//   load                       current overrides + change history + PM overrides
//   save   {table, value}      validate and store a replacement for one table
//   reset  {table}             drop the replacement (built-in values apply again)
//   restore {id}               put back what a history entry replaced
//   pmSet  {AU,PT,PD,AG}       type in the official LBMA PM rate (USD/oz)
//   pmClear                    remove the typed PM rates
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const HISTORY_MAX = 200;

export default async (req, ctx = {}) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await authorize(req, ctx.authOptions || {});
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = body && body.action;

  const store = ctx.dataStore || getStore("app-data");
  const metalStore = ctx.metalStore || getStore("metal-rates-cache");

  try {
    if (action === "login") return json({ ok: true });

    if (action === "load") {
      const overrides = await readOverrides(store);
      const history = (await store.get("history", { type: "json" }).catch(() => null)) || [];
      const pm = (await metalStore.get("pm-override", { type: "json" }).catch(() => null)) || {};
      return json({
        ok: true,
        version: overrides.version,
        overrides: overrides.tables,
        history: history.slice(0, 60).map(({ id, table, at, action: a }) => ({ id, table, at, action: a })),
        pmOverride: pm,
      });
    }

    if (action === "save" || action === "reset" || action === "restore") {
      const overrides = await readOverrides(store);
      let history = (await store.get("history", { type: "json" }).catch(() => null)) || [];
      const stamp = new Date().toISOString();
      let table, entryAction, newValue; // newValue === undefined -> remove override

      if (action === "restore") {
        const entry = history.find((h) => h.id === body.id);
        if (!entry) return json({ error: "History entry not found" }, 404);
        table = entry.table;
        entryAction = "restore";
        newValue = entry.before === null ? undefined : entry.before;
      } else {
        table = body.table;
        if (!TABLES.includes(table)) return json({ error: `Unknown table "${table}"` }, 400);
        entryAction = action;
        newValue = action === "reset" ? undefined : body.value;
      }

      let cleaned;
      if (newValue !== undefined) {
        const check = validateTable(table, newValue, overrides.tables);
        if (!check.ok) return json({ error: check.error }, 400);
        cleaned = check.value;
      }
      // resetting a table must not leave another table pointing at something that no longer exists
      if (newValue === undefined && (table === "currency" || table === "locations")) {
        const probe = { ...overrides.tables };
        delete probe[table];
        const other = table === "currency" ? "locations" : "currency";
        const probeVal = probe[other] ? probe[other].value : defaultTable(other);
        const check = validateTable(other, probeVal, probe);
        if (!check.ok) return json({ error: `Cannot reset ${table}: ${check.error}` }, 400);
      }

      const before = overrides.tables[table] ? overrides.tables[table].value : null;
      history.unshift({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        table, at: stamp, action: entryAction, before, after: cleaned === undefined ? null : cleaned,
      });
      history = history.slice(0, HISTORY_MAX);

      if (cleaned === undefined) delete overrides.tables[table];
      else overrides.tables[table] = { value: cleaned, updatedAt: stamp };
      overrides.version += 1;

      await store.setJSON("history", history);      // history first: a failure here never loses the change record
      await store.setJSON("overrides", overrides);
      return json({ ok: true, version: overrides.version, table, saved: cleaned === undefined ? null : cleaned });
    }

    if (action === "pmSet") {
      const cur = (await metalStore.get("pm-override", { type: "json" }).catch(() => null)) || {};
      const now = londonNow();
      let any = false;
      for (const code of METAL_CODES) {
        if (body[code] === undefined || body[code] === "") continue;
        const price = Number(body[code]);
        if (!isFinite(price) || price <= 0 || price > 1e7) return json({ error: `Bad price for ${code}` }, 400);
        cur[code] = { price, label: `${now.label} PM (manual)`, setAt: new Date().toISOString() };
        any = true;
      }
      if (!any) return json({ error: "No prices given" }, 400);
      await metalStore.setJSON("pm-override", cur);
      return json({ ok: true, pmOverride: cur });
    }

    if (action === "pmClear") {
      await metalStore.setJSON("pm-override", {});
      return json({ ok: true, pmOverride: {} });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: `Server error: ${err.message}` }, 500);
  }
};
