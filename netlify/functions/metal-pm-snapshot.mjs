import { getStore } from "@netlify/blobs";
import { METALS, FIX_WINDOW_MIN, londonNow, fixMinutes, fetchSpot } from "./_metalPolicy.mjs";

// Scheduled every 5 minutes on weekdays. Each run checks London time and, for
// any metal whose LBMA fix time has just passed (within FIX_WINDOW_MIN) and
// that has no snapshot yet today, stores the live spot price as that metal's
// "PM rate". London time is computed with Intl so BST/GMT never matters.
export default async () => {
  const store = getStore("metal-rates-cache");
  const now = londonNow();
  const snap = (await store.get("pm-snapshot", { type: "json" }).catch(() => null)) || {};
  const done = [];
  for (const [code, m] of Object.entries(METALS)) {
    const fix = fixMinutes(m.fixLondon);
    const due = now.minutesOfDay >= fix && now.minutesOfDay < fix + FIX_WINDOW_MIN;
    if (!due || (snap[code] && snap[code].dateKey === now.dateKey)) continue;
    try {
      const price = await fetchSpot(m.symbol);
      snap[code] = { price, dateKey: now.dateKey, label: now.label, capturedAt: new Date().toISOString() };
      done.push(code);
    } catch (e) {
      console.error("PM snapshot failed for", code, e.message);
    }
  }
  if (done.length) await store.setJSON("pm-snapshot", snap);
  return new Response(JSON.stringify({ captured: done, london: now.label }), { status: 200 });
};

export const config = { schedule: "*/5 10-16 * * 1-5" };
