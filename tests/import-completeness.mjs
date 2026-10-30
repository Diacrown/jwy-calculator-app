// Run: node tests/import-completeness.mjs
// A CAD job must never load with fewer stones than the form lists without a warning.
import assert from "node:assert/strict";
import { parseOrderFormJson } from "../src/pdfParser.js";

const base = { JobNo: "7938", ItemNo: "B00875_1", _STONE_TYPES: "Lab grown", _STONE_SOURCES: "Customer, HO", _STONE_SETTINGS: "Prong" };
const row = (o) => ({ Pos: "Center", Stone: "Lab grown", Shape: "Round", L: "2.6", W: "2.6", H: "1.6", AvgWt: 0.073, Qty: 1, Tot: 0.073, Set: "Prong", Source: "Customer", ...o });
const run = (stones, extra = {}) => {
  const r = parseOrderFormJson({ ...base, _RAW_STONES: stones, ...extra }, { alloys: [], diaSize: [] });
  assert.ok(r.ok !== false, "parse ok");
  return r.data || r;
};

// 1. complete table, matching total -> no warning
let d = run([row(), row({ Pos: "Side", Qty: 5, Tot: 0.2, Source: "HO" })], { _STONE_QTY: "6" });
assert.equal(d.stones.length, 2); assert.equal(d.importWarnings.length, 0);

// 2. the job 7938 shape: form says 6 pcs, second row has no Shape -> kept, flagged, warned
d = run([row(), row({ Pos: "Side", Shape: "", Qty: 5, Source: "HO" })], { _STONE_QTY: "6 pcs" });
assert.equal(d.stones.length, 2, "row without shape is kept");
assert.ok(d.stones[1].unfinished && d.stones[1].isCustom && d.stones[1].priced === false);
assert.equal(d.stones[1].qty, 5);
assert.ok(d.importWarnings.some((w) => /shape missing/.test(w)));
assert.equal(d.cadSheet.stones.length, 2);

// 3. row with shape but blank/zero qty -> kept, flagged
d = run([row(), row({ Pos: "Side", Qty: "" })], { _STONE_QTY: "1" });
assert.equal(d.stones.length, 2); assert.ok(d.importWarnings.some((w) => /quantity missing/.test(w)));

// 4. rows silently absent from the table but the form's total is larger -> total mismatch warning
d = run([row()], { _STONE_QTY: "6" });
assert.equal(d.stones.length, 1);
assert.ok(d.importWarnings.some((w) => /form says 6 pcs but only 1 pcs/.test(w)));

// 5. tolerant quantity text
d = run([row({ Qty: "1,000 pcs", Tot: "" })], {});
assert.equal(d.stones[0].qty, 1000);

// 6. no stone table at all but form lists pcs -> warned, not treated as clean
d = run(undefined, { _STONE_QTY: "6" });
assert.ok(d.importWarnings.length >= 1);

// 7. genuine Mount / blank rows are not flagged
d = run([{ Pos: "", Stone: "Mount", Shape: "", Qty: "" }, {}], {});
assert.equal(d.importWarnings.length, 0); assert.ok(d.stoneless);

// 8. job-7938 shape with the form's per-line Studded: Lab grown x5 marked Studded=No, form says 6 pcs
d = run([row({ Studded: "Yes" }), row({ Pos: "Side", Qty: 5, Source: "HO", Studded: "No" })], { _STONE_QTY: "6" });
assert.equal(d.stones.length, 1);
assert.ok(d.importWarnings.some((w) => /Studded = No but still list 5 pcs of Lab grown/.test(w)), "studded-no pcs surfaced");
assert.ok(d.importWarnings.some((w) => /form says 6 pcs but only 1 pcs/.test(w)));
// a plain Mount line marked Studded=No is the normal case: no warning
d = run([row({ Studded: "Yes" }), { Pos: "Setting", Stone: "Mount", Shape: "", Qty: "", Studded: "No" }], { _STONE_QTY: "1" });
assert.equal(d.importWarnings.length, 0); assert.ok(d.unstuddedLine);

console.log("import-completeness: all checks passed");
