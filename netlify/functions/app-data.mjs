import { getStore } from "@netlify/blobs";
import { readOverrides, effectiveTables, toCalculatorShape, liveFx } from "./_appData.mjs";

// The calculator's data service (replaces the old Google "DATA TABLE" sheet).
//
//   GET /.netlify/functions/app-data
//     -> { data, sources, version, fx }
//
//   data     every price / rate table, in the shape the calculator keeps in state
//   sources  per table: "built-in" (factory values), "developer" (changed in the
//            developer console), "live-fx" / "live-fx-cache" (FX from the free feed)
//
// Read-only and public (the calculator itself needs it). Changing values needs the
// developer token -- see dev-admin.mjs. If anything here fails, the calculator
// simply keeps using its built-in copy of the same tables.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async () => {
  try {
    const overrides = await readOverrides(getStore("app-data"));
    const { tables, source } = effectiveTables(overrides);
    const data = toCalculatorShape(tables);
    const sources = {
      alloys: source.alloys,
      currencyRates: source.currency,
      locations: source.locations,
      cadFeesAndLabor: source.labor,
      settingTiers: source.settingTiers,
      naturalPrices: source.naturalPrices,
      fancyPrices: source.fancyPrices,
      labGrownPrices: source.labGrownPrices,
    };

    let fx = null;
    if (tables.currency.mode === "live") {
      const codes = new Set(Object.keys(tables.currency.rates));
      for (const l of tables.locations) codes.add(l.currency);
      fx = await liveFx(getStore("app-data"), [...codes]);
      if (fx) {
        data.currencyRates = { ...data.currencyRates, ...fx.rates, USD: 1 };
        sources.currencyRates = fx.stale ? "live-fx-cache" : "live-fx";
      }
    }
    return json({ data, sources, version: overrides.version, fx: fx ? { date: fx.date, fetchedAt: fx.fetchedAt, stale: fx.stale } : null });
  } catch (err) {
    return json({ error: `Data service error: ${err.message}` }, 502);
  }
};
