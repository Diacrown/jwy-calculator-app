import { useState, useMemo, useCallback, useEffect } from "react";
import { fetchLiveSheetData } from "./sheetData.js";
import { POLL_INTERVAL_MS } from "./config.js";
import { parseOrderFormJson } from "./pdfParser.js";

/* ============================================================
   REFERENCE DATA
   In production, METAL_RATES and CURRENCY_RATES should be
   replaced by a live fetch (see fetchLiveRates below) pointed
   at a published Google Sheet CSV endpoint.
   ============================================================ */

const SAMPLE_METAL_RATES = {
  AU: { label: "Gold", pmRateOz: 4026.45, spotOz: 3984.96, spotSurcharge: 1.05, wastage: 1.1, asOf: "Mon 29 Jun 2026 PM" },
  PT: { label: "Platinum", pmRateOz: 1588.0, spotOz: 1566.5, spotSurcharge: 1.05, wastage: 1.22, asOf: "Mon 29 Jun 2026" },
  PD: { label: "Palladium", pmRateOz: 1212.0, spotOz: 1223.0, spotSurcharge: 1.05, wastage: 0.215, asOf: "Mon 29 Jun 2026" },
  AG: { label: "Silver", pmRateOz: 57.71, spotOz: 57.52, spotSurcharge: 1.05, wastage: 1.25, asOf: "Mon 29 Jun 2026" },
};

const SAMPLE_CURRENCY_RATES = {
  USD: 1.0,
  EUR: 0.93,
  AUD: 1.66,
  NZD: 1.81,
  GBP: 0.8,
  PLN: 4.15,
  INR: 86.5,
};
const CURRENCY_MARKUP = 1.05;

const LOCATIONS = [
  { code: "DMG", currency: "EUR", duty: 0.03 },
  { code: "DMT", currency: "USD", duty: 0.2 },
  { code: "WSME", currency: "AUD", duty: 0.05 },
  { code: "WSSY", currency: "AUD", duty: 0.05 },
  { code: "WSBN", currency: "AUD", duty: 0.05 },
  { code: "WSNZ", currency: "NZD", duty: 0.05 },
  { code: "WSUK", currency: "GBP", duty: 0.02 },
  { code: "WSIT", currency: "EUR", duty: 0.02 },
  { code: "WSPL", currency: "PLN", duty: 0.02 },
  { code: "DMR", currency: "INR", duty: 0.0 },
];

// Shape display order for the Select Size dropdown, matching the CAD
// Order Form's own shape dropdown sequence.
const SHAPE_ORDER = [
  "Round", "Baguette", "Carre", "Emerald", "Heart", "Marquise", "Oval",
  "Princess", "Pear", "Radiant", "Single Cut", "Sq. Cushion", "Sq. Emerald",
  "Tappered Bagguette", "Triangle", "Trilliant",
];

const ALLOYS = [
  { name: "Standard Injection Wax", short: "Wax", sg: 0.96, purity: 1.0, metal: "WX", castingGm: 1.0, surchargeGm: 1.0, minGms: 7.0 },
  { name: "United Casting Bronze #342", short: "Brass", sg: 8.5, purity: 1.0, metal: "AY", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "9KT White (Nickel Safe - USA)", short: "9KT WG", sg: 11.0, purity: 0.375, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "9KT White (Nickel Free - EU)", short: "9KT WG-NF", sg: 11.75, purity: 0.375, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "9KT Yellow Gold", short: "9KT YG", sg: 11.3, purity: 0.375, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "9KT Rose Gold", short: "9KT RG", sg: 11.3, purity: 0.375, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "10KT White (Nickel Safe - USA)", short: "10KT WG", sg: 11.07, purity: 0.417, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "10KT White (Nickel Free - EU)", short: "10KT WG-NF", sg: 12.38, purity: 0.417, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "10KT Yellow Gold", short: "10KT YG", sg: 11.55, purity: 0.417, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "10KT Rose Gold", short: "10KT RG", sg: 11.55, purity: 0.417, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "14KT White (Nickel Safe - USA)", short: "14KT WG", sg: 13.05, purity: 0.583, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "14KT White (Palladium - EU)", short: "14KT WG-PD", sg: 14.25, purity: 0.583, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "14KT Yellow Gold", short: "14KT YG", sg: 13.05, purity: 0.583, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "14KT Rose Gold", short: "14KT RG", sg: 13.05, purity: 0.583, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "18KT White (Nickel Safe - USA)", short: "18KT WG", sg: 14.75, purity: 0.75, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "18KT White (Palladium - EU)", short: "18KT WG-PD", sg: 15.82, purity: 0.75, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "18KT Yellow Gold", short: "18KT YG", sg: 14.75, purity: 0.75, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "18KT Rose Gold", short: "18KT RG", sg: 14.75, purity: 0.75, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "22KT Gold", short: "22KT", sg: 17.8, purity: 0.917, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "24KT Gold (Fine)", short: "24KT", sg: 19.36, purity: 1.0, metal: "AU", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 600", short: "PT600", sg: 13.05, purity: 0.6, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 900", short: "PT900", sg: 20.0, purity: 0.9, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 950", short: "PT950", sg: 21.5, purity: 0.952, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Standard 925 Silver", short: "AG925", sg: 10.3, purity: 0.925, metal: "AG", castingGm: 15.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Argentium Silver (935)", short: "AG935", sg: 10.4, purity: 0.935, metal: "AG", castingGm: 15.0, surchargeGm: 5.0, minGms: 7.0 },
];

// Casting cost fields now live per-alloy (castingGm, surchargeGm, minGms
// in the ALLOYS table above), and the WG-PD kicker is derived dynamically
// from Palladium's own live rate -- see alloyRatePerGm() below.

const LABOR_PER_GM = 22.0;
const LABOR_MIN_FLAT = 55.0;

const CAD_FEES = { None: 0, Simple: 50, Medium: 75, Complex: 100, Advanced: 200 };

// Setting charge tiers: upto ct/pc, rate, rate type
const SETTING_TIERS = [
  { uptoCt: 0.04, rate: 1.0, type: "PER PC" },
  { uptoCt: 0.09, rate: 2.25, type: "PER PC" },
  { uptoCt: 0.14, rate: 3.5, type: "PER PC" },
  { uptoCt: 0.19, rate: 4.75, type: "PER PC" },
  { uptoCt: 0.29, rate: 7.5, type: "PER PC" },
  { uptoCt: 99.0, rate: 25.0, type: "PER CT" },
];

function settingRateFor(wtPerPc, tiers = SETTING_TIERS) {
  for (const tier of tiers) {
    if (wtPerPc <= tier.uptoCt) return tier;
  }
  return tiers[tiers.length - 1];
}

// DiaSize: shape/size catalog (trimmed to representative + commonly used entries)
const DIA_SIZE = [
  { code: "RND0.7M", key: "RND0.7M", shape: "Round", size: "0.7 mm (0.002 ct ±)", wt: 0.002, group: "R00" },
  { code: "RND0.8M", key: "RND0.8M", shape: "Round", size: "0.8 mm (0.003 ct ±)", wt: 0.003, group: "R00" },
  { code: "RND0.9M", key: "RND0.9M", shape: "Round", size: "0.9 mm (0.004 ct ±)", wt: 0.004, group: "R00" },
  { code: "RND1.0M", key: "RND1.0M", shape: "Round", size: "1.0 mm (0.005 ct ±)", wt: 0.005, group: "R00" },
  { code: "RND1.1M", key: "RND1.1M", shape: "Round", size: "1.1 mm (0.006 ct ±)", wt: 0.006, group: "R00" },
  { code: "RND1.2M", key: "RND1.2M", shape: "Round", size: "1.2 mm (0.008 ct ±)", wt: 0.008, group: "R02" },
  { code: "RND1.3M", key: "RND1.3M", shape: "Round", size: "1.3 mm (0.01 ct ±)", wt: 0.01, group: "R02" },
  { code: "RND1.4M", key: "RND1.4M", shape: "Round", size: "1.4 mm (0.012 ct ±)", wt: 0.012, group: "R02" },
  { code: "RND1.5M", key: "RND1.5M", shape: "Round", size: "1.5 mm (0.015 ct ±)", wt: 0.015, group: "R02" },
  { code: "RND1.6M", key: "RND1.6M", shape: "Round", size: "1.6 mm (0.017 ct ±)", wt: 0.017, group: "R09" },
  { code: "RND1.7M", key: "RND1.7M", shape: "Round", size: "1.7 mm (0.02 ct ±)", wt: 0.02, group: "R09" },
  { code: "RND1.8M", key: "RND1.8M", shape: "Round", size: "1.8 mm (0.023 ct ±)", wt: 0.023, group: "R09" },
  { code: "RND1.9M", key: "RND1.9M", shape: "Round", size: "1.9 mm (0.027 ct ±)", wt: 0.028, group: "R09" },
  { code: "RND2.0M", key: "RND2.0M", shape: "Round", size: "2.0 mm (0.03 ct ±)", wt: 0.032, group: "R11" },
  { code: "RND2.1M", key: "RND2.1M", shape: "Round", size: "2.1 mm (0.04 ct ±)", wt: 0.04, group: "R11" },
  { code: "RND2.2M", key: "RND2.2M", shape: "Round", size: "2.2 mm (0.045 ct ±)", wt: 0.045, group: "R11" },
  { code: "RND2.3M", key: "RND2.3M", shape: "Round", size: "2.3 mm (0.05 ct ±)", wt: 0.05, group: "R12" },
  { code: "RND2.4M", key: "RND2.4M", shape: "Round", size: "2.4 mm (0.055 ct ±)", wt: 0.055, group: "R12" },
  { code: "RND2.5M", key: "RND2.5M", shape: "Round", size: "2.5 mm (0.06 ct ±)", wt: 0.063, group: "R12" },
  { code: "RND2.6M", key: "RND2.6M", shape: "Round", size: "2.6 mm (0.07 ct ±)", wt: 0.073, group: "R14" },
  { code: "RND2.7M", key: "RND2.7M", shape: "Round", size: "2.7 mm (0.08ct ±)", wt: 0.08, group: "R14" },
  { code: "RND2.8M", key: "RND2.8M", shape: "Round", size: "2.8 mm (0.08-0.09 ct ±)", wt: 0.087, group: "R18" },
  { code: "RND2.9M", key: "RND2.9M", shape: "Round", size: "2.9 mm (0.09-0.10 ct ±)", wt: 0.097, group: "R18" },
  { code: "RND3.0M", key: "RND3.0M", shape: "Round", size: "3.0 mm (0.10-0.11 ct ±)", wt: 0.107, group: "R20" },
  { code: "RND3.1M", key: "RND3.1M", shape: "Round", size: "3.1 mm (0.11-0.12 ct ±)", wt: 0.117, group: "R20" },
  { code: "RND3.2M", key: "RND3.2M", shape: "Round", size: "3.2 mm (0.12-0.13 ct ±)", wt: 0.127, group: "R23" },
  { code: "RND3.3M", key: "RND3.3M", shape: "Round", size: "3.3 mm (0.14-0.145 ct ±)", wt: 0.143, group: "R23" },
  { code: "RND3.4M", key: "RND3.4M", shape: "Round", size: "3.4 mm (0.15-0.16 ct ±)", wt: 0.155, group: "R25" },
  { code: "RND3.5M", key: "RND3.5M", shape: "Round", size: "3.5 mm (0.16-0.17 ct ±)", wt: 0.165, group: "R25" },
  { code: "RND3.6M", key: "RND3.6M", shape: "Round", size: "3.6 mm (0.17-0.18 ct ±)", wt: 0.175, group: "R25" },
  { code: "RND3.7M", key: "RND3.7M", shape: "Round", size: "3.7 mm (0.19-0.21 ct ±)", wt: 0.2, group: "R30" },
  { code: "RND3.8M", key: "RND3.8M", shape: "Round", size: "3.8 mm (0.21-0.23 ct ±)", wt: 0.22, group: "R30" },
  { code: "RND3.9M", key: "RND3.9M", shape: "Round", size: "3.9 mm (0.23-0.24 ct ±)", wt: 0.235, group: "R30" },
  { code: "RND4.0M", key: "RND4.0M", shape: "Round", size: "4.0 mm (0.24-0.26 ct ±)", wt: 0.255, group: "R30" },
  { code: "RND4.1M", key: "RND4.1M", shape: "Round", size: "4.1 mm (0.26-0.29 ct ±)", wt: 0.275, group: "R30" },
  { code: "RND030W", key: "RND030W", shape: "Round", size: "4.2-4.4 mm ± (0.30-0.34 ct)", wt: 0.32, group: "R30" },
  { code: "RND038W", key: "RND038W", shape: "Round", size: "4.4-4.6 mm ± (0.35-0.39 ct)", wt: 0.365, group: "R38" },
  { code: "RND040W", key: "RND040W", shape: "Round", size: "4.6-4.8 mm ± (0.40-0.44 ct)", wt: 0.415, group: "R40" },
  { code: "RND046W", key: "RND046W", shape: "Round", size: "4.7-4.9 mm ± (0.45-0.49 ct)", wt: 0.47, group: "R46" },
  { code: "RND050W", key: "RND050W", shape: "Round", size: "5.0-5.2 mm ± (0.50-0.59 ct)", wt: 0.51, group: "R50" },
  { code: "RND060W", key: "RND060W", shape: "Round", size: "5.3-5.5 mm ± (0.60-0.69 ct)", wt: 0.61, group: "R60" },
  { code: "RND070W", key: "RND070W", shape: "Round", size: "5.5-5.7 mm ± (0.70-0.73 ct)", wt: 0.72, group: "R70" },
  { code: "RND075W", key: "RND075W", shape: "Round", size: "5.7-5.8 mm ± (0.74-0.79 ct)", wt: 0.76, group: "R75" },
  { code: "RND080W", key: "RND080W", shape: "Round", size: "5.8-6.0 mm ± (0.80-0.89 ct)", wt: 0.81, group: "R80" },
  { code: "BAG1210M", key: "BAG1210M", shape: "Baguette", size: "1.25 x 1.00 mm", wt: 0.009, group: null },
  { code: "BAG1507M", key: "BAG1507M", shape: "Baguette", size: "1.50 x 0.75 mm", wt: 0.008, group: null },
  { code: "BAG1510M", key: "BAG1510M", shape: "Baguette", size: "1.50 x 1.00 mm", wt: 0.01, group: null },
  { code: "BAG1512M", key: "BAG1512M", shape: "Baguette", size: "1.50 x 1.25 mm", wt: 0.02, group: null },
  { code: "BAG1707M", key: "BAG1707M", shape: "Baguette", size: "1.75 x 0.75 mm", wt: 0.02, group: null },
  { code: "BAG1710M", key: "BAG1710M", shape: "Baguette", size: "1.75 x 1.00 mm", wt: 0.01, group: null },
  { code: "BAG1712M", key: "BAG1712M", shape: "Baguette", size: "1.75 x 1.25 mm", wt: 0.02, group: null },
  { code: "BAG1715M", key: "BAG1715M", shape: "Baguette", size: "1.75 x 1.50 mm", wt: 0.03, group: null },
  { code: "BAG2007M", key: "BAG2007M", shape: "Baguette", size: "2.00 x 0.75 mm", wt: 0.01, group: null },
  { code: "BAG2010M", key: "BAG2010M", shape: "Baguette", size: "2.00 x 1.00 mm", wt: 0.02, group: null },
  { code: "BAG2012M", key: "BAG2012M", shape: "Baguette", size: "2.00 x 1.25 mm", wt: 0.02, group: null },
  { code: "BAG2015M", key: "BAG2015M", shape: "Baguette", size: "2.00 x 1.50 mm", wt: 0.03, group: null },
  { code: "BAG2017M", key: "BAG2017M", shape: "Baguette", size: "2.00 x 1.75 mm", wt: 0.04, group: null },
  { code: "BAG2207M", key: "BAG2207M", shape: "Baguette", size: "2.25 x 0.75 mm", wt: 0.01, group: null },
  { code: "BAG2210M", key: "BAG2210M", shape: "Baguette", size: "2.25 x 1.00 mm", wt: 0.02, group: null },
  { code: "BAG2212M", key: "BAG2212M", shape: "Baguette", size: "2.25 x 1.25 mm", wt: 0.03, group: null },
  { code: "BAG2215M", key: "BAG2215M", shape: "Baguette", size: "2.25 x 1.50 mm", wt: 0.04, group: null },
  { code: "BAG2217M", key: "BAG2217M", shape: "Baguette", size: "2.25 x 1.75 mm", wt: 0.05, group: null },
  { code: "BAG2507M", key: "BAG2507M", shape: "Baguette", size: "2.50 x 0.75 mm", wt: 0.02, group: null },
  { code: "BAG2510M", key: "BAG2510M", shape: "Baguette", size: "2.50 x 1.00 mm", wt: 0.02, group: null },
  { code: "BAG2512M", key: "BAG2512M", shape: "Baguette", size: "2.50 x 1.25 mm", wt: 0.03, group: null },
  { code: "BAG2515M", key: "BAG2515M", shape: "Baguette", size: "2.50 x 1.50 mm", wt: 0.04, group: null },
  { code: "BAG2517M", key: "BAG2517M", shape: "Baguette", size: "2.50 x 1.75 mm", wt: 0.06, group: null },
  { code: "BAG2520M", key: "BAG2520M", shape: "Baguette", size: "2.50 x 2.00 mm", wt: 0.07, group: null },
  { code: "BAG2710M", key: "BAG2710M", shape: "Baguette", size: "2.75 x 1.00 mm", wt: 0.02, group: null },
  { code: "BAG2712M", key: "BAG2712M", shape: "Baguette", size: "2.75 x 1.25 mm", wt: 0.04, group: null },
  { code: "BAG2715M", key: "BAG2715M", shape: "Baguette", size: "2.75 x 1.50 mm", wt: 0.05, group: null },
  { code: "BAG2717M", key: "BAG2717M", shape: "Baguette", size: "2.75 x 1.75 mm", wt: 0.06, group: null },
  { code: "BAG2720M", key: "BAG2720M", shape: "Baguette", size: "2.75 x 2.00 mm", wt: 0.08, group: null },
  { code: "BAG2722M", key: "BAG2722M", shape: "Baguette", size: "2.75 x 2.25 mm", wt: 0.1, group: null },
  { code: "BAG3010M", key: "BAG3010M", shape: "Baguette", size: "3.00 x 1.00 mm", wt: 0.03, group: null },
  { code: "BAG3012M", key: "BAG3012M", shape: "Baguette", size: "3.00 x 1.25 mm", wt: 0.04, group: null },
  { code: "BAG3015M", key: "BAG3015M", shape: "Baguette", size: "3.00 x 1.50 mm", wt: 0.06, group: null },
  { code: "BAG3017M", key: "BAG3017M", shape: "Baguette", size: "3.00 x 1.75 mm", wt: 0.07, group: null },
  { code: "BAG3020M", key: "BAG3020M", shape: "Baguette", size: "3.00 x 2.00 mm", wt: 0.09, group: null },
  { code: "BAG3022M", key: "BAG3022M", shape: "Baguette", size: "3.00 x 2.25 mm", wt: 0.11, group: null },
  { code: "BAG3025M", key: "BAG3025M", shape: "Baguette", size: "3.00 x 2.50 mm", wt: 0.12, group: null },
  { code: "BAG3210M", key: "BAG3210M", shape: "Baguette", size: "3.25 x 1.00 mm", wt: 0.03, group: null },
  { code: "BAG3212M", key: "BAG3212M", shape: "Baguette", size: "3.25 x 1.25 mm", wt: 0.04, group: null },
  { code: "BAG3215M", key: "BAG3215M", shape: "Baguette", size: "3.25 x 1.50 mm", wt: 0.06, group: null },
  { code: "BAG3217M", key: "BAG3217M", shape: "Baguette", size: "3.25 x 1.75 mm", wt: 0.08, group: null },
  { code: "BAG3220M", key: "BAG3220M", shape: "Baguette", size: "3.25 x 2.00 mm", wt: 0.1, group: null },
  { code: "BAG3222M", key: "BAG3222M", shape: "Baguette", size: "3.25 x 2.25 mm", wt: 0.12, group: null },
  { code: "BAG3225M", key: "BAG3225M", shape: "Baguette", size: "3.25 x 2.50 mm", wt: 0.14, group: null },
  { code: "BAG3510M", key: "BAG3510M", shape: "Baguette", size: "3.50 x 1.00 mm", wt: 0.04, group: null },
  { code: "BAG3512M", key: "BAG3512M", shape: "Baguette", size: "3.50 x 1.25 mm", wt: 0.05, group: null },
  { code: "BAG3515M", key: "BAG3515M", shape: "Baguette", size: "3.50 x 1.50 mm", wt: 0.07, group: null },
  { code: "BAG3517M", key: "BAG3517M", shape: "Baguette", size: "3.50 x 1.75 mm", wt: 0.09, group: null },
  { code: "BAG3520M", key: "BAG3520M", shape: "Baguette", size: "3.50 x 2.00 mm", wt: 0.11, group: null },
  { code: "BAG3522M", key: "BAG3522M", shape: "Baguette", size: "3.50 x 2.25 mm", wt: 0.12, group: null },
  { code: "BAG3525M", key: "BAG3525M", shape: "Baguette", size: "3.50 x 2.50 mm", wt: 0.14, group: null },
  { code: "BAG3710M", key: "BAG3710M", shape: "Baguette", size: "3.75 x 1.00 mm", wt: 0.04, group: null },
  { code: "BAG3712M", key: "BAG3712M", shape: "Baguette", size: "3.75 x 1.25 mm", wt: 0.05, group: null },
  { code: "BAG3715M", key: "BAG3715M", shape: "Baguette", size: "3.75 x 1.50 mm", wt: 0.07, group: null },
  { code: "BAG3717M", key: "BAG3717M", shape: "Baguette", size: "3.75 x 1.75 mm", wt: 0.09, group: null },
  { code: "BAG3720M", key: "BAG3720M", shape: "Baguette", size: "3.75 x 2.00 mm", wt: 0.12, group: null },
  { code: "BAG3722M", key: "BAG3722M", shape: "Baguette", size: "3.75 x 2.25 mm", wt: 0.14, group: null },
  { code: "BAG3725M", key: "BAG3725M", shape: "Baguette", size: "3.75 x 2.50 mm", wt: 0.16, group: null },
  { code: "BAG4012M", key: "BAG4012M", shape: "Baguette", size: "4.00 x 1.25 mm", wt: 0.05, group: null },
  { code: "BAG4015M", key: "BAG4015M", shape: "Baguette", size: "4.00 x 1.50 mm", wt: 0.07, group: null },
  { code: "BAG4017M", key: "BAG4017M", shape: "Baguette", size: "4.00 x 1.75 mm", wt: 0.1, group: null },
  { code: "BAG4020M", key: "BAG4020M", shape: "Baguette", size: "4.00 x 2.00 mm", wt: 0.13, group: null },
  { code: "BAG4022M", key: "BAG4022M", shape: "Baguette", size: "4.00 x 2.25 mm", wt: 0.16, group: null },
  { code: "BAG4025M", key: "BAG4025M", shape: "Baguette", size: "4.00 x 2.50 mm", wt: 0.19, group: null },
  { code: "BAG4027M", key: "BAG4027M", shape: "Baguette", size: "4.00 x 2.75 mm", wt: 0.2, group: null },
  { code: "BAG4030M", key: "BAG4030M", shape: "Baguette", size: "4.00 x 3.00 mm", wt: 0.23, group: null },
  { code: "BAG4212M", key: "BAG4212M", shape: "Baguette", size: "4.25 x 1.25 mm", wt: 0.06, group: null },
  { code: "BAG4215M", key: "BAG4215M", shape: "Baguette", size: "4.25 x 1.50 mm", wt: 0.08, group: null },
  { code: "BAG4217M", key: "BAG4217M", shape: "Baguette", size: "4.25 x 1.75 mm", wt: 0.1, group: null },
  { code: "BAG4220M", key: "BAG4220M", shape: "Baguette", size: "4.25 x 2.00 mm", wt: 0.14, group: null },
  { code: "BAG4222M", key: "BAG4222M", shape: "Baguette", size: "4.25 x 2.25 mm", wt: 0.15, group: null },
  { code: "BAG4225M", key: "BAG4225M", shape: "Baguette", size: "4.25 x 2.50 mm", wt: 0.19, group: null },
  { code: "BAG4227M", key: "BAG4227M", shape: "Baguette", size: "4.25 x 2.75 mm", wt: 0.24, group: null },
  { code: "BAG4512M", key: "BAG4512M", shape: "Baguette", size: "4.50 x 1.25 mm", wt: 0.06, group: null },
  { code: "BAG4515M", key: "BAG4515M", shape: "Baguette", size: "4.50 x 1.50 mm", wt: 0.09, group: null },
  { code: "BAG4517M", key: "BAG4517M", shape: "Baguette", size: "4.50 x 1.75 mm", wt: 0.12, group: null },
  { code: "BAG4520M", key: "BAG4520M", shape: "Baguette", size: "4.50 x 2.00 mm", wt: 0.15, group: null },
  { code: "BAG4522M", key: "BAG4522M", shape: "Baguette", size: "4.50 x 2.25 mm", wt: 0.18, group: null },
  { code: "BAG4525M", key: "BAG4525M", shape: "Baguette", size: "4.50 x 2.50 mm", wt: 0.21, group: null },
  { code: "BAG4527M", key: "BAG4527M", shape: "Baguette", size: "4.50 x 2.75 mm", wt: 0.25, group: null },
  { code: "BAG4530M", key: "BAG4530M", shape: "Baguette", size: "4.50 x 3.00 mm", wt: 0.28, group: null },
  { code: "BAG4715M", key: "BAG4715M", shape: "Baguette", size: "4.75 x 1.50 mm", wt: 0.09, group: null },
  { code: "BAG4720M", key: "BAG4720M", shape: "Baguette", size: "4.75 x 2.00 mm", wt: 0.15, group: null },
  { code: "BAG4725M", key: "BAG4725M", shape: "Baguette", size: "4.75 x 2.50 mm", wt: 0.22, group: null },
  { code: "BAG5020M", key: "BAG5020M", shape: "Baguette", size: "5.00 x 2.00 mm", wt: 0.17, group: null },
  { code: "BAG5025M", key: "BAG5025M", shape: "Baguette", size: "5.00 x 2.50 mm", wt: 0.24, group: null },
  { code: "BAG5030M", key: "BAG5030M", shape: "Baguette", size: "5.00 x 3.00 mm", wt: 0.32, group: null },
  { code: "BAG5525M", key: "BAG5525M", shape: "Baguette", size: "5.50 x 2.50 mm", wt: 0.27, group: null },
  { code: "BAG5530M", key: "BAG5530M", shape: "Baguette", size: "5.50 x 3.00 mm", wt: 0.36, group: null },
  { code: "BAG6030M", key: "BAG6030M", shape: "Baguette", size: "6.00 x 3.00 mm", wt: 0.42, group: null },
  { code: "CAR1.5M", key: "CAR1.5M", shape: "Carre", size: "1.5 mm", wt: 0.02, group: null },
  { code: "CAR1.6M", key: "CAR1.6M", shape: "Carre", size: "1.6 mm", wt: 0.025, group: null },
  { code: "CAR1.7M", key: "CAR1.7M", shape: "Carre", size: "1.7 mm", wt: 0.03, group: null },
  { code: "CAR1.8M", key: "CAR1.8M", shape: "Carre", size: "1.8 mm", wt: 0.035, group: null },
  { code: "CAR1.9M", key: "CAR1.9M", shape: "Carre", size: "1.9 mm", wt: 0.04, group: null },
  { code: "CAR2.0M", key: "CAR2.0M", shape: "Carre", size: "2.0 mm", wt: 0.05, group: null },
  { code: "CAR2.1M", key: "CAR2.1M", shape: "Carre", size: "2.1 mm", wt: 0.06, group: null },
  { code: "CAR2.2M", key: "CAR2.2M", shape: "Carre", size: "2.2 mm", wt: 0.07, group: null },
  { code: "CAR2.3M", key: "CAR2.3M", shape: "Carre", size: "2.3 mm", wt: 0.08, group: null },
  { code: "CAR2.4M", key: "CAR2.4M", shape: "Carre", size: "2.4 mm", wt: 0.09, group: null },
  { code: "CAR2.5M", key: "CAR2.5M", shape: "Carre", size: "2.5 mm", wt: 0.1, group: null },
  { code: "CAR2.6M", key: "CAR2.6M", shape: "Carre", size: "2.6 mm", wt: 0.11, group: null },
  { code: "CAR2.7M", key: "CAR2.7M", shape: "Carre", size: "2.7 mm", wt: 0.12, group: null },
  { code: "CAR2.8M", key: "CAR2.8M", shape: "Carre", size: "2.8 mm", wt: 0.13, group: null },
  { code: "CAR3.0M", key: "CAR3.0M", shape: "Carre", size: "3.0 mm", wt: 0.15, group: null },
  { code: "CAR3.2M", key: "CAR3.2M", shape: "Carre", size: "3.2 mm", wt: 0.2, group: null },
  { code: "CAR3.5M", key: "CAR3.5M", shape: "Carre", size: "3.5 mm", wt: 0.25, group: null },
  { code: "CAR3.8M", key: "CAR3.8M", shape: "Carre", size: "3.8 mm", wt: 0.33, group: null },
  { code: "CAR4.0M", key: "CAR4.0M", shape: "Carre", size: "4.0 mm", wt: 0.4, group: null },
  { code: "EME033W", key: "EME033W", shape: "Emerald", size: "4.50 x 3.30 mm", wt: 0.33, group: null },
  { code: "EME040W", key: "EME040W", shape: "Emerald", size: "5.00 x 3.50 mm", wt: 0.37, group: null },
  { code: "EME3023M", key: "EME3023M", shape: "Emerald", size: "3.00 x 2.30 mm", wt: 0.1, group: null },
  { code: "EME3223M", key: "EME3223M", shape: "Emerald", size: "3.20 x 2.30 mm", wt: 0.1, group: null },
  { code: "EME3725M", key: "EME3725M", shape: "Emerald", size: "3.75 x 2.50 mm", wt: 0.15, group: null },
  { code: "EME3727M", key: "EME3727M", shape: "Emerald", size: "3.75 x 2.75 mm", wt: 0.19, group: null },
  { code: "EME4030M", key: "EME4030M", shape: "Emerald", size: "4.00 x 3.00 mm", wt: 0.24, group: null },
  { code: "EME4430M", key: "EME4430M", shape: "Emerald", size: "4.45 x 3.00 mm", wt: 0.275, group: null },
  { code: "HRT033W", key: "HRT033W", shape: "Heart", size: "4.10 x 4.60 mm", wt: 0.33, group: null },
  { code: "HRT037W", key: "HRT037W", shape: "Heart", size: "4.20 x 4.80 mm", wt: 0.37, group: null },
  { code: "HRT2730M", key: "HRT2730M", shape: "Heart", size: "2.70 x 3.00 mm", wt: 0.1, group: null },
  { code: "HRT3235M", key: "HRT3235M", shape: "Heart", size: "3.20 x 3.50 mm", wt: 0.15, group: null },
  { code: "HRT3638M", key: "HRT3638M", shape: "Heart", size: "3.60 x 3.80 mm", wt: 0.2, group: null },
  { code: "HRT3943M", key: "HRT3943M", shape: "Heart", size: "3.90 x 4.30 mm", wt: 0.25, group: null },
  { code: "MQS033W", key: "MQS033W", shape: "Marquise", size: "6.00 x 3.50 mm", wt: 0.33, group: null },
  { code: "MQS2512M", key: "MQS2512M", shape: "Marquise", size: "2.50 x 1.25 mm", wt: 0.02, group: null },
  { code: "MQS3015M", key: "MQS3015M", shape: "Marquise", size: "3.00 x 1.50 mm", wt: 0.04, group: null },
  { code: "MQS3116M", key: "MQS3116M", shape: "Marquise", size: "3.10 x 1.60 mm", wt: 0.04, group: null },
  { code: "MQS3517M", key: "MQS3517M", shape: "Marquise", size: "3.50 x 1.75 mm", wt: 0.05, group: null },
  { code: "MQS3520M", key: "MQS3520M", shape: "Marquise", size: "3.50 x 2.00 mm", wt: 0.05, group: null },
  { code: "MQS3717M", key: "MQS3717M", shape: "Marquise", size: "3.75 x 1.75 mm", wt: 0.05, group: null },
  { code: "MQS4020M", key: "MQS4020M", shape: "Marquise", size: "4.00 x 2.00 mm", wt: 0.065, group: null },
  { code: "MQS4222M", key: "MQS4222M", shape: "Marquise", size: "4.25 x 2.25 mm", wt: 0.07, group: null },
  { code: "MQS4525M", key: "MQS4525M", shape: "Marquise", size: "4.50 x 2.25 mm", wt: 0.09, group: null },
  { code: "MQS5025M", key: "MQS5025M", shape: "Marquise", size: "5.00 x 2.50 mm", wt: 0.12, group: null },
  { code: "MQS5030M", key: "MQS5030M", shape: "Marquise", size: "5.00 x 3.00 mm", wt: 0.2, group: null },
  { code: "MQS6030M", key: "MQS6030M", shape: "Marquise", size: "6.00 x 3.00 mm", wt: 0.25, group: null },
  { code: "OVL030W", key: "OVL030W", shape: "Oval", size: "5.40 x 3.80 mm", wt: 0.33, group: null },
  { code: "OVL3020M", key: "OVL3020M", shape: "Oval", size: "3.00 x 2.00 mm", wt: 0.055, group: null },
  { code: "OVL3023M", key: "OVL3023M", shape: "Oval", size: "3.00 x 2.30 mm", wt: 0.07, group: null },
  { code: "OVL3525M", key: "OVL3525M", shape: "Oval", size: "3.50 x 2.50 mm", wt: 0.09, group: null },
  { code: "OVL3627M", key: "OVL3627M", shape: "Oval", size: "3.60 x 2.70 mm", wt: 0.1, group: null },
  { code: "OVL4030M", key: "OVL4030M", shape: "Oval", size: "4.00 x 3.00 mm", wt: 0.15, group: null },
  { code: "OVL4535M", key: "OVL4535M", shape: "Oval", size: "4.50 x 3.50 mm", wt: 0.2, group: null },
  { code: "OVL4833M", key: "OVL4833M", shape: "Oval", size: "4.80 x 3.30 mm", wt: 0.21, group: null },
  { code: "OVL5035M", key: "OVL5035M", shape: "Oval", size: "5.00 x 3.50 mm", wt: 0.25, group: null },
  { code: "PRN014W", key: "PRN014W#1", shape: "Princess", size: "2.9 mm", wt: 0.14, group: null },
  { code: "PRN014W", key: "PRN014W#2", shape: "Princess", size: "3.0 mm", wt: 0.15, group: null },
  { code: "PRN014W", key: "PRN014W#3", shape: "Princess", size: "3.1 mm", wt: 0.17, group: null },
  { code: "PRN020W", key: "PRN020W#1", shape: "Princess", size: "3.2 mm", wt: 0.19, group: null },
  { code: "PRN020W", key: "PRN020W#2", shape: "Princess", size: "3.3 mm", wt: 0.22, group: null },
  { code: "PRN025W", key: "PRN025W#1", shape: "Princess", size: "3.4 mm", wt: 0.24, group: null },
  { code: "PRN025W", key: "PRN025W#2", shape: "Princess", size: "3.5 mm", wt: 0.26, group: null },
  { code: "PRN025W", key: "PRN025W#3", shape: "Princess", size: "3.6 mm", wt: 0.28, group: null },
  { code: "PRN030W", key: "PRN030W", shape: "Princess", size: "3.7 mm", wt: 0.33, group: null },
  { code: "PRN040W", key: "PRN040W", shape: "Princess", size: "4.0 mm", wt: 0.4, group: null },
  { code: "PRN046W", key: "PRN046W", shape: "Princess", size: "4.1 mm", wt: 0.46, group: null },
  { code: "PRN050W", key: "PRN050W", shape: "Princess", size: "4.3 mm", wt: 0.5, group: null },
  { code: "PRN060W", key: "PRN060W", shape: "Princess", size: "4.5 mm", wt: 0.6, group: null },
  { code: "PRN1.4M", key: "PRN1.4M", shape: "Princess", size: "1.4 mm", wt: 0.015, group: null },
  { code: "PRN1.5M", key: "PRN1.5M", shape: "Princess", size: "1.5 mm", wt: 0.02, group: null },
  { code: "PRN1.6M", key: "PRN1.6M", shape: "Princess", size: "1.6 mm", wt: 0.025, group: null },
  { code: "PRN1.7M", key: "PRN1.7M", shape: "Princess", size: "1.7 mm", wt: 0.03, group: null },
  { code: "PRN1.8M", key: "PRN1.8M", shape: "Princess", size: "1.8 mm", wt: 0.035, group: null },
  { code: "PRN1.9M", key: "PRN1.9M", shape: "Princess", size: "1.9 mm", wt: 0.04, group: null },
  { code: "PRN2.0M", key: "PRN2.0M", shape: "Princess", size: "2.0 mm", wt: 0.05, group: null },
  { code: "PRN2.1M", key: "PRN2.1M", shape: "Princess", size: "2.1 mm", wt: 0.06, group: null },
  { code: "PRN2.2M", key: "PRN2.2M", shape: "Princess", size: "2.2 mm", wt: 0.07, group: null },
  { code: "PRN2.3M", key: "PRN2.3M", shape: "Princess", size: "2.3 mm", wt: 0.08, group: null },
  { code: "PRN2.4M", key: "PRN2.4M", shape: "Princess", size: "2.4 mm", wt: 0.09, group: null },
  { code: "PRN2.5M", key: "PRN2.5M", shape: "Princess", size: "2.5 mm", wt: 0.1, group: null },
  { code: "PRN2.6M", key: "PRN2.6M", shape: "Princess", size: "2.6 mm", wt: 0.11, group: null },
  { code: "PRN2.7M", key: "PRN2.7M", shape: "Princess", size: "2.7 mm", wt: 0.12, group: null },
  { code: "PRN2.8M", key: "PRN2.8M", shape: "Princess", size: "2.8 mm", wt: 0.13, group: null },
  { code: "PSH030W", key: "PSH030W", shape: "Pear", size: "5.70 x 3.70 mm", wt: 0.33, group: null },
  { code: "PSH040W", key: "PSH040W", shape: "Pear", size: "6.00 x 4.00 mm", wt: 0.33, group: null },
  { code: "PSH2517M", key: "PSH2517M", shape: "Pear", size: "2.50 x 1.7 mm", wt: 0.03, group: null },
  { code: "PSH3020M", key: "PSH3020M", shape: "Pear", size: "3.00 x 2.00 mm", wt: 0.05, group: null },
  { code: "PSH3522M", key: "PSH3522M", shape: "Pear", size: "3.50 x 2.20 mm", wt: 0.07, group: null },
  { code: "PSH4025M", key: "PSH4025M", shape: "Pear", size: "4.00 x 2.50 mm", wt: 0.1, group: null },
  { code: "PSH4030M", key: "PSH4030M", shape: "Pear", size: "4.00 x 3.00 mm", wt: 0.14, group: null },
  { code: "PSH4127M", key: "PSH4127M", shape: "Pear", size: "4.10 x 2.70 mm", wt: 0.11, group: null },
  { code: "PSH4530M", key: "PSH4530M", shape: "Pear", size: "4.50 x 3.00 mm", wt: 0.15, group: null },
  { code: "PSH5030M", key: "PSH5030M", shape: "Pear", size: "5.00 x 3.00 mm", wt: 0.2, group: null },
  { code: "PSH5535M", key: "PSH5535M", shape: "Pear", size: "5.50 x 3.50 mm", wt: 0.25, group: null },
  { code: "RAD2320M", key: "RAD2320M", shape: "Radiant", size: "2.30 x 2.00 mm", wt: 0.05, group: null },
  { code: "RAD2723M", key: "RAD2723M", shape: "Radiant", size: "2.70 x 2.30 mm", wt: 0.1, group: null },
  { code: "RAD3024M", key: "RAD3024M", shape: "Radiant", size: "3.00 x 2.40 mm", wt: 0.1, group: null },
  { code: "RAD3528M", key: "RAD3528M", shape: "Radiant", size: "3.50 x 2.80 mm", wt: 0.15, group: null },
  { code: "RAD3830M", key: "RAD3830M", shape: "Radiant", size: "3.80 x 3.00 mm", wt: 0.2, group: null },
  { code: "RAD4035M", key: "RAD4035M", shape: "Radiant", size: "4.00 x 3.50 mm", wt: 0.25, group: null },
  { code: "SCU30M", key: "SCU30M", shape: "Sq. Cushion", size: "3.00 x 3.00 mm", wt: 0.15, group: null },
  { code: "SCU33M", key: "SCU33M", shape: "Sq. Cushion", size: "3.30 x 3.30 mm", wt: 0.2, group: null },
  { code: "SCU36M", key: "SCU36M", shape: "Sq. Cushion", size: "3.60 x 3.60 mm", wt: 0.25, group: null },
  { code: "SCU38M", key: "SCU38M", shape: "Sq. Cushion", size: "3.80 x 3.80 mm", wt: 0.33, group: null },
  { code: "SCU42M", key: "SCU42M", shape: "Sq. Cushion", size: "4.25 x 4.25 mm", wt: 0.37, group: null },
  { code: "SEM033W", key: "SEM033W", shape: "Sq. Emerald", size: "4.00 x 4.00 mm", wt: 0.4, group: null },
  { code: "SEM15M", key: "SEM15M", shape: "Sq. Emerald", size: "1.50 x 1.50 mm", wt: 0.02, group: null },
  { code: "SEM16M", key: "SEM16M", shape: "Sq. Emerald", size: "1.60 x 1.60 mm", wt: 0.025, group: null },
  { code: "SEM17M", key: "SEM17M", shape: "Sq. Emerald", size: "1.70 x 1.70 mm", wt: 0.03, group: null },
  { code: "SEM18M", key: "SEM18M", shape: "Sq. Emerald", size: "1.80 x 1.80 mm", wt: 0.035, group: null },
  { code: "SEM19M", key: "SEM19M", shape: "Sq. Emerald", size: "1.90 x 1.90 mm", wt: 0.04, group: null },
  { code: "SEM20M", key: "SEM20M", shape: "Sq. Emerald", size: "2.00 x 2.00 mm", wt: 0.05, group: null },
  { code: "SEM21M", key: "SEM21M", shape: "Sq. Emerald", size: "2.10 x 2.10 mm", wt: 0.06, group: null },
  { code: "SEM22M", key: "SEM22M", shape: "Sq. Emerald", size: "2.20 x 2.20 mm", wt: 0.07, group: null },
  { code: "SEM23M", key: "SEM23M", shape: "Sq. Emerald", size: "2.30 x 2.30 mm", wt: 0.08, group: null },
  { code: "SEM24M", key: "SEM24M", shape: "Sq. Emerald", size: "2.40 x 2.40 mm", wt: 0.08, group: null },
  { code: "SEM25M", key: "SEM25M", shape: "Sq. Emerald", size: "2.50 x 2.50 mm", wt: 0.095, group: null },
  { code: "SEM26M", key: "SEM26M", shape: "Sq. Emerald", size: "2.60 x 2.60 mm", wt: 0.1, group: null },
  { code: "SEM27M", key: "SEM27M", shape: "Sq. Emerald", size: "2.70 x 2.70 mm", wt: 0.11, group: null },
  { code: "SEM28M", key: "SEM28M", shape: "Sq. Emerald", size: "2.80 x 2.80 mm", wt: 0.12, group: null },
  { code: "SEM29M", key: "SEM29M", shape: "Sq. Emerald", size: "2.90 x 2.90 mm", wt: 0.135, group: null },
  { code: "SEM30M", key: "SEM30M", shape: "Sq. Emerald", size: "3.00 x 3.00 mm", wt: 0.15, group: null },
  { code: "SEM31M", key: "SEM31M", shape: "Sq. Emerald", size: "3.10 x 3.10 mm", wt: 0.17, group: null },
  { code: "SEM32M", key: "SEM32M", shape: "Sq. Emerald", size: "3.20 x 3.20 mm", wt: 0.19, group: null },
  { code: "SEM33M", key: "SEM33M", shape: "Sq. Emerald", size: "3.30 x 3.30 mm", wt: 0.2, group: null },
  { code: "SEM34M", key: "SEM34M", shape: "Sq. Emerald", size: "3.40 x 3.40 mm", wt: 0.24, group: null },
  { code: "SEM35M", key: "SEM35M", shape: "Sq. Emerald", size: "3.50 x 3.50 mm", wt: 0.26, group: null },
  { code: "SEM36M", key: "SEM36M", shape: "Sq. Emerald", size: "3.60 x 3.60 mm", wt: 0.33, group: null },
  { code: "TAP151007", key: "TAP151007", shape: "Tappered Bagguette", size: "1.50 x 1.00 x 0.75 mm", wt: 0.01, group: null },
  { code: "TAP151210", key: "TAP151210", shape: "Tappered Bagguette", size: "1.50 x 1.25 x 1.00 mm", wt: 0.01, group: null },
  { code: "TAP170705", key: "TAP170705", shape: "Tappered Bagguette", size: "1.75 x 0.75 x 0.50 mm", wt: 0.008, group: null },
  { code: "TAP171005", key: "TAP171005", shape: "Tappered Bagguette", size: "1.75 x 1.00 x 0.50 mm", wt: 0.01, group: null },
  { code: "TAP171007", key: "TAP171007", shape: "Tappered Bagguette", size: "1.75 x 1.00 x 0.75 mm", wt: 0.01, group: null },
  { code: "TAP171210", key: "TAP171210", shape: "Tappered Bagguette", size: "1.75 x 1.25 x 1.00 mm", wt: 0.02, group: null },
  { code: "TAP171510", key: "TAP171510", shape: "Tappered Bagguette", size: "1.75 x 1.50 x 1.00 mm", wt: 0.02, group: null },
  { code: "TAP171512", key: "TAP171512", shape: "Tappered Bagguette", size: "1.75 x 1.50 x 1.25 mm", wt: 0.02, group: null },
  { code: "TAP201005", key: "TAP201005", shape: "Tappered Bagguette", size: "2.00 x 1.00 x 0.50 mm", wt: 0.01, group: null },
  { code: "TAP201007", key: "TAP201007", shape: "Tappered Bagguette", size: "2.00 x 1.00 x 0.75 mm", wt: 0.01, group: null },
  { code: "TAP201210", key: "TAP201210", shape: "Tappered Bagguette", size: "2.00 x 1.25 x 1.00 mm", wt: 0.02, group: null },
  { code: "TAP201510", key: "TAP201510", shape: "Tappered Bagguette", size: "2.00 x 1.50 x 1.00 mm", wt: 0.02, group: null },
  { code: "TAP201512", key: "TAP201512", shape: "Tappered Bagguette", size: "2.00 x 1.50 x 1.25 mm", wt: 0.03, group: null },
  { code: "TAP221005", key: "TAP221005", shape: "Tappered Bagguette", size: "2.25 x 1.00 x 0.50 mm", wt: 0.01, group: null },
  { code: "TAP221207", key: "TAP221207", shape: "Tappered Bagguette", size: "2.25 x 1.25 x 0.75 mm", wt: 0.02, group: null },
  { code: "TAP221210", key: "TAP221210", shape: "Tappered Bagguette", size: "2.25 x 1.25 x 1.00 mm", wt: 0.02, group: null },
  { code: "TAP221510", key: "TAP221510", shape: "Tappered Bagguette", size: "2.25 x 1.50 x 1.00 mm", wt: 0.03, group: null },
  { code: "TAP221512", key: "TAP221512", shape: "Tappered Bagguette", size: "2.25 x 1.50 x 1.25 mm", wt: 0.04, group: null },
  { code: "TAP221712", key: "TAP221712", shape: "Tappered Bagguette", size: "2.25 x 1.75 x 1.25 mm", wt: 0.04, group: null },
  { code: "TAP221715", key: "TAP221715", shape: "Tappered Bagguette", size: "2.25 x 1.75 x 1.50 mm", wt: 0.05, group: null },
  { code: "TAP222015", key: "TAP222015", shape: "Tappered Bagguette", size: "2.25 x 2.00 x 1.50 mm", wt: 0.05, group: null },
  { code: "TAP251005", key: "TAP251005", shape: "Tappered Bagguette", size: "2.50 x 1.00 x 0.50 mm", wt: 0.02, group: null },
  { code: "TAP251007", key: "TAP251007", shape: "Tappered Bagguette", size: "2.50 x 1.00 x 0.75 mm", wt: 0.02, group: null },
  { code: "TAP251210", key: "TAP251210", shape: "Tappered Bagguette", size: "2.50 x 1.25 x 1.00 mm", wt: 0.03, group: null },
  { code: "TAP251510", key: "TAP251510", shape: "Tappered Bagguette", size: "2.50 x 1.50 x 1.00 mm", wt: 0.03, group: null },
  { code: "TAP251512", key: "TAP251512", shape: "Tappered Bagguette", size: "2.50 x 1.50 x 1.25 mm", wt: 0.04, group: null },
  { code: "TAP251710", key: "TAP251710", shape: "Tappered Bagguette", size: "2.50 x 1.75 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP251712", key: "TAP251712", shape: "Tappered Bagguette", size: "2.50 x 1.75 x 1.25 mm", wt: 0.05, group: null },
  { code: "TAP252015", key: "TAP252015", shape: "Tappered Bagguette", size: "2.50 x 2.00 x 1.50 mm", wt: 0.05, group: null },
  { code: "TAP271005", key: "TAP271005", shape: "Tappered Bagguette", size: "2.75 x 1.00 x 0.50 mm", wt: 0.02, group: null },
  { code: "TAP271207", key: "TAP271207", shape: "Tappered Bagguette", size: "2.75 x 1.25 x 0.75 mm", wt: 0.03, group: null },
  { code: "TAP271210", key: "TAP271210", shape: "Tappered Bagguette", size: "2.75 x 1.25 x 1.00 mm", wt: 0.03, group: null },
  { code: "TAP271510", key: "TAP271510", shape: "Tappered Bagguette", size: "2.75 x 1.50 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP271512", key: "TAP271512", shape: "Tappered Bagguette", size: "2.75 x 1.50 x 1.25 mm", wt: 0.04, group: null },
  { code: "TAP271712", key: "TAP271712", shape: "Tappered Bagguette", size: "2.75 x 1.75 x 1.25 mm", wt: 0.05, group: null },
  { code: "TAP271715", key: "TAP271715", shape: "Tappered Bagguette", size: "2.75 x 1.75 x 1.50 mm", wt: 0.05, group: null },
  { code: "TAP272015", key: "TAP272015", shape: "Tappered Bagguette", size: "2.75 x 2.00 x 1.50 mm", wt: 0.07, group: null },
  { code: "TAP301207", key: "TAP301207", shape: "Tappered Bagguette", size: "3.00 x 1.25 x 0.75 mm", wt: 0.03, group: null },
  { code: "TAP301210", key: "TAP301210", shape: "Tappered Bagguette", size: "3.00 x 1.25 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP301510", key: "TAP301510", shape: "Tappered Bagguette", size: "3.00 x 1.50 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP301512", key: "TAP301512", shape: "Tappered Bagguette", size: "3.00 x 1.50 x 1.25 mm", wt: 0.05, group: null },
  { code: "TAP301710", key: "TAP301710", shape: "Tappered Bagguette", size: "3.00 x 1.75 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP301712", key: "TAP301712", shape: "Tappered Bagguette", size: "3.00 x 1.75 x 1.25 mm", wt: 0.06, group: null },
  { code: "TAP302010", key: "TAP302010", shape: "Tappered Bagguette", size: "3.00 x 2.00 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP302015", key: "TAP302015", shape: "Tappered Bagguette", size: "3.00 x 2.00 x 1.50 mm", wt: 0.07, group: null },
  { code: "TAP302017", key: "TAP302017", shape: "Tappered Bagguette", size: "3.00 x 2.00 x 1.75 mm", wt: 0.08, group: null },
  { code: "TAP302517", key: "TAP302517", shape: "Tappered Bagguette", size: "3.00 x 2.50 x 1.75 mm", wt: 0.09, group: null },
  { code: "TAP321005", key: "TAP321005", shape: "Tappered Bagguette", size: "3.25 x 1.00 x 0.50 mm", wt: 0.02, group: null },
  { code: "TAP321207", key: "TAP321207", shape: "Tappered Bagguette", size: "3.25 x 1.25 x 0.75 mm", wt: 0.03, group: null },
  { code: "TAP321210", key: "TAP321210", shape: "Tappered Bagguette", size: "3.25 x 1.25 x 1.00 mm", wt: 0.03, group: null },
  { code: "TAP321507", key: "TAP321507", shape: "Tappered Bagguette", size: "3.25 x 1.50 x 0.75 mm", wt: 0.04, group: null },
  { code: "TAP321510", key: "TAP321510", shape: "Tappered Bagguette", size: "3.25 x 1.50 x 1.00 mm", wt: 0.05, group: null },
  { code: "TAP321512", key: "TAP321512", shape: "Tappered Bagguette", size: "3.25 x 1.50 x 1.25 mm", wt: 0.05, group: null },
  { code: "TAP321710", key: "TAP321710", shape: "Tappered Bagguette", size: "3.25 x 1.75 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP321712", key: "TAP321712", shape: "Tappered Bagguette", size: "3.25 x 1.75 x 1.25 mm", wt: 0.06, group: null },
  { code: "TAP321715", key: "TAP321715", shape: "Tappered Bagguette", size: "3.25 x 1.75 x 1.50 mm", wt: 0.06, group: null },
  { code: "TAP322010", key: "TAP322010", shape: "Tappered Bagguette", size: "3.25 x 2.00 x 1.00 mm", wt: 0.07, group: null },
  { code: "TAP322012", key: "TAP322012", shape: "Tappered Bagguette", size: "3.25 x 2.00 x 1.25 mm", wt: 0.07, group: null },
  { code: "TAP322015", key: "TAP322015", shape: "Tappered Bagguette", size: "3.25 x 2.00 x 1.50 mm", wt: 0.07, group: null },
  { code: "TAP322517", key: "TAP322517", shape: "Tappered Bagguette", size: "3.25 x 2.50 x 1.75 mm", wt: 0.1, group: null },
  { code: "TAP351210", key: "TAP351210", shape: "Tappered Bagguette", size: "3.50 x 1.25 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP351510", key: "TAP351510", shape: "Tappered Bagguette", size: "3.50 x 1.50 x 1.00 mm", wt: 0.05, group: null },
  { code: "TAP351512", key: "TAP351512", shape: "Tappered Bagguette", size: "3.50 x 1.50 x 1.25 mm", wt: 0.05, group: null },
  { code: "TAP351710", key: "TAP351710", shape: "Tappered Bagguette", size: "3.50 x 1.75 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP351712", key: "TAP351712", shape: "Tappered Bagguette", size: "3.50 x 1.75 x 1.25 mm", wt: 0.07, group: null },
  { code: "TAP352010", key: "TAP352010", shape: "Tappered Bagguette", size: "3.50 x 2.00 x 1.00 mm", wt: 0.08, group: null },
  { code: "TAP352012", key: "TAP352012", shape: "Tappered Bagguette", size: "3.50 x 2.00 x 1.25 mm", wt: 0.08, group: null },
  { code: "TAP352015", key: "TAP352015", shape: "Tappered Bagguette", size: "3.50 x 2.00 x 1.50 mm", wt: 0.08, group: null },
  { code: "TAP352515", key: "TAP352515", shape: "Tappered Bagguette", size: "3.50 x 2.50 x 1.50 mm", wt: 0.1, group: null },
  { code: "TAP371210", key: "TAP371210", shape: "Tappered Bagguette", size: "3.75 x 1.25 x 1.00 mm", wt: 0.05, group: null },
  { code: "TAP371510", key: "TAP371510", shape: "Tappered Bagguette", size: "3.75 x 1.50 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP371712", key: "TAP371712", shape: "Tappered Bagguette", size: "3.75 x 1.75 x 1.25 mm", wt: 0.07, group: null },
  { code: "TAP372012", key: "TAP372012", shape: "Tappered Bagguette", size: "3.75 x 2.00 x 1.25 mm", wt: 0.09, group: null },
  { code: "TAP372015", key: "TAP372015", shape: "Tappered Bagguette", size: "3.75 x 2.00 x 1.50 mm", wt: 0.1, group: null },
  { code: "TAP372217", key: "TAP372217", shape: "Tappered Bagguette", size: "3.75 x 2.25 x 1.75 mm", wt: 0.11, group: null },
  { code: "TAP401210", key: "TAP401210", shape: "Tappered Bagguette", size: "4.00 x 1.25 x 1.00 mm", wt: 0.04, group: null },
  { code: "TAP401510", key: "TAP401510", shape: "Tappered Bagguette", size: "4.00 x 1.50 x 1.00 mm", wt: 0.06, group: null },
  { code: "TAP401712", key: "TAP401712", shape: "Tappered Bagguette", size: "4.00 x 1.75 x 1.25 mm", wt: 0.08, group: null },
  { code: "TAP402010", key: "TAP402010", shape: "Tappered Bagguette", size: "4.00 x 2.00 x 1.00 mm", wt: 0.08, group: null },
  { code: "TAP402015", key: "TAP402015", shape: "Tappered Bagguette", size: "4.00 x 2.00 x 1.50 mm", wt: 0.1, group: null },
  { code: "TAP402515", key: "TAP402515", shape: "Tappered Bagguette", size: "4.00 x 2.50 x 1.50 mm", wt: 0.13, group: null },
  { code: "TAP402517", key: "TAP402517", shape: "Tappered Bagguette", size: "4.00 x 2.50 x 1.75 mm", wt: 0.13, group: null },
  { code: "TAP422015", key: "TAP422015", shape: "Tappered Bagguette", size: "4.25 x 2.00 x 1.50 mm", wt: 0.11, group: null },
  { code: "TAP422215", key: "TAP422215", shape: "Tappered Bagguette", size: "4.25 x 2.25 x 1.50 mm", wt: 0.13, group: null },
  { code: "TAP422515", key: "TAP422515", shape: "Tappered Bagguette", size: "4.25 x 2.50 x 1.50 mm", wt: 0.14, group: null },
  { code: "TAP422717", key: "TAP422717", shape: "Tappered Bagguette", size: "4.25 x 2.75 x 1.75 mm", wt: 0.18, group: null },
  { code: "TAP451512", key: "TAP451512", shape: "Tappered Bagguette", size: "4.50 x 1.50 x 1.25 mm", wt: 0.08, group: null },
  { code: "TAP452010", key: "TAP452010", shape: "Tappered Bagguette", size: "4.50 x 2.00 x 1.00 mm", wt: 0.09, group: null },
  { code: "TAP452015", key: "TAP452015", shape: "Tappered Bagguette", size: "4.50 x 2.00 x 1.50 mm", wt: 0.11, group: null },
  { code: "TAP452215", key: "TAP452215", shape: "Tappered Bagguette", size: "4.50 x 2.25 x 1.50 mm", wt: 0.13, group: null },
  { code: "TAP452515", key: "TAP452515", shape: "Tappered Bagguette", size: "4.50 x 2.50 x 1.50 mm", wt: 0.16, group: null },
  { code: "TAP452517", key: "TAP452517", shape: "Tappered Bagguette", size: "4.50 x 2.50 x 1.75 mm", wt: 0.15, group: null },
  { code: "TAP452717", key: "TAP452717", shape: "Tappered Bagguette", size: "4.50 x 2.75 x 1.75 mm", wt: 0.19, group: null },
  { code: "TAP471715", key: "TAP471715", shape: "Tappered Bagguette", size: "4.75 x 1.75 x 1.50 mm", wt: 0.11, group: null },
  { code: "TAP472015", key: "TAP472015", shape: "Tappered Bagguette", size: "4.75 x 2.00 x 1.50 mm", wt: 0.13, group: null },
  { code: "TAP472515", key: "TAP472515", shape: "Tappered Bagguette", size: "4.75 x 2.50 x 1.50 mm", wt: 0.17, group: null },
  { code: "TAP472520", key: "TAP472520", shape: "Tappered Bagguette", size: "4.75 x 2.50 x 2.00 mm", wt: 0.18, group: null },
  { code: "TAP473020", key: "TAP473020", shape: "Tappered Bagguette", size: "4.75 x 3.00 x 2.00 mm", wt: 0.22, group: null },
  { code: "TAP502212", key: "TAP502212", shape: "Tappered Bagguette", size: "5.00 x 2.25 x 1.25 mm", wt: 0.13, group: null },
  { code: "TAP502217", key: "TAP502217", shape: "Tappered Bagguette", size: "5.00 x 2.25 x 1.75 mm", wt: 0.16, group: null },
  { code: "TAP502720", key: "TAP502720", shape: "Tappered Bagguette", size: "5.00 x 2.75 x 2.00 mm", wt: 0.23, group: null },
  { code: "TAP552510", key: "TAP552510", shape: "Tappered Bagguette", size: "5.50 x 2.50 x 1.00 mm", wt: 0.17, group: null },
  { code: "TAP552522", key: "TAP552522", shape: "Tappered Bagguette", size: "5.50 x 2.50 x 2.25 mm", wt: 0.23, group: null },
  { code: "TAP553022", key: "TAP553022", shape: "Tappered Bagguette", size: "5.50 x 3.00 x 2.25 mm", wt: 0.3, group: null },
  { code: "TAP602015", key: "TAP602015", shape: "Tappered Bagguette", size: "6.00 x 2.00 x 1.50 mm", wt: 0.18, group: null },
  { code: "TAP603022", key: "TAP603022", shape: "Tappered Bagguette", size: "6.00 x 3.00 x 2.25 mm", wt: 0.28, group: null },
  { code: "TRG030W", key: "TRG030W", shape: "Triangle", size: "5.00 x 5.00 x 5.00 mm", wt: 0.3, group: null },
  { code: "TRG040W", key: "TRG040W", shape: "Triangle", size: "5.50 x 5.50 x 5.50 mm", wt: 0.37, group: null },
  { code: "TRG25M", key: "TRG25M", shape: "Triangle", size: "2.50 x 2.50 x 2.50 mm", wt: 0.04, group: null },
  { code: "TRG30M", key: "TRG30M", shape: "Triangle", size: "3.00 x 3.00 x 3.00 mm", wt: 0.09, group: null },
  { code: "TRG35M", key: "TRG35M", shape: "Triangle", size: "3.50 x 3.50 x 3.50 mm", wt: 0.12, group: null },
  { code: "TRG40M", key: "TRG40M", shape: "Triangle", size: "4.00 x 4.00 x 4.00 mm", wt: 0.15, group: null },
  { code: "TRG45M", key: "TRG45M", shape: "Triangle", size: "4.50 x 4.50 x 4.50 mm", wt: 0.22, group: null },
  { code: "TRN011W", key: "TRN011W", shape: "Trilliant", size: "3.3~3.6 mm", wt: 0.1, group: null },
  { code: "TRN014W", key: "TRN014W", shape: "Trilliant", size: "3.7~3.9 mm", wt: 0.15, group: null },
  { code: "TRN020W", key: "TRN020W", shape: "Trilliant", size: "4.0~4.2 mm", wt: 0.2, group: null },
  { code: "TRN025W", key: "TRN025W", shape: "Trilliant", size: "4.30~4.4 mm", wt: 0.25, group: null },
  { code: "TRN030W", key: "TRN030W", shape: "Trilliant", size: "4.5~5.0 mm", wt: 0.33, group: null },
  { code: "TRN040W", key: "TRN040W", shape: "Trilliant", size: "5.5~5.8 mm", wt: 0.4, group: null },
];

// DiaSSP: $/ct grid by group code and clarity grade. INFERRED row-group
// mapping for the small M-suffix sizes (R00-R25) -- confirm against real
// DiaSize column E and correct if needed.
const DIA_SSP = {
  R00: { "TW VS": 470, "TW SI1": 450, "TW SI2": 410, "TW SI3": 390, "TW I1": 350, "WH SI": 370, "IJ SI2-I1": 340 },
  R02: { "TW VS": 420, "TW SI1": 400, "TW SI2": 370, "TW SI3": 350, "TW I1": 320, "WH SI": 330, "IJ SI2-I1": 300 },
  R09: { "TW VS": 540, "TW SI1": 520, "TW SI2": 470, "TW SI3": 450, "TW I1": 410, "WH SI": 430, "IJ SI2-I1": 365 },
  R11: { "TW VS": 550, "TW SI1": 530, "TW SI2": 480, "TW SI3": 460, "TW I1": 420, "WH SI": 430, "IJ SI2-I1": 390 },
  R12: { "TW VS": 650, "TW SI1": 620, "TW SI2": 560, "TW SI3": 540, "TW I1": 480, "WH SI": 490, "IJ SI2-I1": 435 },
  R14: { "TW VS": 770, "TW SI1": 710, "TW SI2": 650, "TW SI3": 630, "TW I1": 550, "WH SI": 550, "IJ SI2-I1": 495 },
  R18: { "TW VS": 770, "TW SI1": 710, "TW SI2": 650, "TW SI3": 630, "TW I1": 550, "WH SI": 550, "IJ SI2-I1": 495 },
  R20: { "TW VS": 850, "TW SI1": 790, "TW SI2": 730, "TW SI3": 690, "TW I1": 610, "WH SI": 580, "IJ SI2-I1": 535 },
  R23: { "TW VS": 920, "TW SI1": 840, "TW SI2": 790, "TW SI3": 750, "TW I1": 650, "WH SI": 620, "IJ SI2-I1": 575 },
  R25: { "TW VS": 920, "TW SI1": 840, "TW SI2": 790, "TW SI3": 750, "TW I1": 650, "WH SI": 620, "IJ SI2-I1": 575 },
  R30: { "TW VS": 950, "TW SI1": 850, "TW SI2": 810, "TW SI3": 780, "TW I1": 660, "WH SI": 650, "IJ SI2-I1": 615 },
  R38: { "TW VS": 1080, "TW SI1": 930, "TW SI2": 830, "TW SI3": 790, "TW I1": 700, "WH SI": 670, "IJ SI2-I1": 640 },
  R40: { "TW VS": 1120, "TW SI1": 950, "TW SI2": 850, "TW SI3": 800, "TW I1": 720, "WH SI": 680, "IJ SI2-I1": 650 },
  R46: { "TW VS": 1150, "TW SI1": 990, "TW SI2": 900, "TW SI3": 830, "TW I1": 740, "WH SI": 740, "IJ SI2-I1": 705 },
  R50: { "TW VS": 1200, "TW SI1": 1000, "TW SI2": 910, "TW SI3": 850, "TW I1": 770, "WH SI": 760, "IJ SI2-I1": 715 },
  R60: { "TW VS": 1300, "TW SI1": 1050, "TW SI2": 920, "TW SI3": 900, "TW I1": 790, "WH SI": 780, "IJ SI2-I1": 740 },
  R70: { "TW SI2": 1200, "TW SI3": 1100, "TW I1": 950, "WH SI": 900, "IJ SI2-I1": 860 },
  R75: { "TW SI2": 1200, "TW SI3": 1100, "TW I1": 950, "WH SI": 900, "IJ SI2-I1": 860 },
  R80: { "TW SI2": 1300, "TW SI3": 1200, "TW I1": 1050, "WH SI": 1050, "IJ SI2-I1": 1000 },
};

const NATURAL_GRADES = ["TW VS", "TW SI1", "TW SI2", "TW SI3", "TW I1", "WH SI", "IJ SI2-I1"];

// LGD pricing: per-ct, banded by carat weight, non-cert vs cert (graded)
const LGD_NONCERT = [
  { shape: "RND", minCt: 0.0, maxCt: 0.0099, rate: 135 }, // ~ -2 (0.005ct)
  { shape: "RND", minCt: 0.01, maxCt: 0.99, rate: 100 },
];
const LGD_CERT = [
  { shape: "RND & FANCY", minCt: 0.9, maxCt: 1.49, labVS: 170, dvvs2: 160, dvs1: null },
  { shape: "RND & FANCY", minCt: 1.5, maxCt: 1.99, labVS: 200, dvvs2: 170, dvs1: null },
  { shape: "RND & FANCY", minCt: 2.0, maxCt: 3.99, labVS: 220, dvvs2: 180, dvs1: null },
  { shape: "RND & FANCY", minCt: 4.0, maxCt: 4.99, labVS: 280, dvvs2: 250, dvs1: null },
  { shape: "FANCY", minCt: 0.01, maxCt: 0.49, labVS: 280, dvvs2: 250, dvs1: 200 },
  { shape: "FANCY", minCt: 0.5, maxCt: 0.89, labVS: 280, dvvs2: 250, dvs1: 150 },
  { shape: "RND", minCt: 0.5, maxCt: 0.89, labVS: 230, dvvs2: 200, dvs1: 100 },
  { shape: "ODD", minCt: 0.01, maxCt: 3.99, labVS: 250, dvvs2: null, dvs1: null },
];
const LGD_GRADES = ["Non-cert", "Lab VS", "D/VVS2", "D/VS1"];

const QUALITY_OPTIONS = [...NATURAL_GRADES, "Lab grown"];

/* ============================================================
   LIVE DATA: see sheetData.js for the multi-tab fetch/parse layer
   and config.js for where to paste your published-sheet URLs.
   ============================================================ */

/* ============================================================
   HELPERS
   ============================================================ */

const fmt = (n, dp = 2) =>
  isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "0.00";

const fmtCurrency = (n, dp = 2) => "$" + fmt(n, dp);

// Rounds a final quote figure UP to the next multiple of 5 (e.g. 682.41
// -> 685, 680.00 -> 680 unchanged since it's already a multiple of 5).
// Applied only to the customer-facing grand totals, not to intermediate
// line items -- rounding every row would compound error and make the
// line items stop summing to the displayed total.
const roundUp5 = (n) => (isFinite(n) ? Math.ceil(n / 5) * 5 : 0);

function emptyRow() {
  return { mode: "natural", shapeSel: "", sizeCode: "", quality: "TW SI1", lgdGrade: "Non-cert", lgdShape: "RND", pcs: "", customShape: "", customWt: "", customRate: "", manualRate: "" };
}

// SSP price cipher (JADELIGHTX): letters encode digits so overseas offices
// can read the price on a customer-facing quote. E.g. 4625 -> "EIAL".
const SSP_MAP = { 1: "J", 2: "A", 3: "D", 4: "E", 5: "L", 6: "I", 7: "G", 8: "H", 9: "T", 0: "X" };
function sspEncode(n) {
  if (!isFinite(n)) return "";
  return String(Math.round(Math.abs(n)))
    .split("")
    .map((d) => SSP_MAP[Number(d)] || "?")
    .join("");
}
// World Shiner logo, embedded as base64 so the print output never depends
// on an external asset URL or hosting path -- works identically on
// Netlify, GitHub Pages, or offline.
const WS_LOGO = "data:image/png;base64,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";

const CUSTOM_CODE = "__CUSTOM__";

// Step 1 (MetalMaster "NetRate/Gm" for the base metal): wastage-adjusted
// base rate, $/gm of PURE metal -- mirrors
// =Round(IF(rateType="Spot", spot*surcharge, pmOz) / 31.1035 * wastage, 2)
function baseNetRatePerGm(metalCode, metalRates) {
  const r = metalRates[metalCode];
  if (!r) return 0;
  const ozRate = r.pmRateOz;
  const wastage = r.wastage ?? 1;
  return Math.round(((ozRate / 31.1035) * wastage) * 100) / 100;
}

// Step 2 (alloy table "Rate/Gm"): base rate x purity, plus the palladium
// kicker when the alloy is a WG-PD variant. Confirmed earlier against
// real sheet data: the kicker is exactly Palladium's own base NetRate/Gm,
// not a fixed constant.
function alloyRatePerGm(alloy, metalRates) {
  const base = baseNetRatePerGm(alloy.metal, metalRates);
  const pdKicker = alloy.short.includes("WG-PD") ? baseNetRatePerGm("PD", metalRates) : 0;
  return base * alloy.purity + pdKicker;
}

// Step 3: casting cost with the confirmed Min-Gms-aware formula --
// =IF(gramWt < MinGms,
//     MIN(gramWt * NetSurchargeRate/Gm, MinGms * NetRate/Gm),
//     gramWt * NetRate/Gm)
// The surcharge only applies as a small-job penalty below the alloy's
// minimum billable weight, and even then never charges more than the
// minimum-weight-at-plain-rate floor. Above the minimum, surcharge drops
// off entirely -- this replaces an earlier version that always added
// the surcharge regardless of weight, which overcharged heavier pieces.
function castingCost(gramWt, alloy, metalRates) {
  if (!alloy || gramWt <= 0) return 0;
  const rateNet = alloyRatePerGm(alloy, metalRates) + alloy.castingGm; // NetRate/Gm
  const rateNetSurcharge = rateNet + alloy.surchargeGm; // NetSurchargeRate/Gm
  const minGms = alloy.minGms ?? 0;
  if (gramWt < minGms) {
    return Math.min(gramWt * rateNetSurcharge, minGms * rateNet);
  }
  return gramWt * rateNet;
}

/* ============================================================
   PDF order form parsing lives in pdfParser.js. It reads the
   embedded %%CAD_FORM_DATA%% JSON block your CAD system writes
   into each card and maps it onto calculator state.
   ============================================================ */

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function JwyCalculator() {
  const [jobInfo, setJobInfo] = useState({
    designer: "Kunal",
    jobNo: "S01022",
    customer: "",
    cadType: "Medium",
  });
  const [location, setLocation] = useState("WSSY");
  // Which round of quoting this represents (Q1 = initial, Q2 = revised,
  // etc.) -- saved with each quote snapshot and shown on the printout so
  // it's clear at a glance which stage a given quote is at.
  const [quoteStage, setQuoteStage] = useState("Q1");
  const [primaryAlloyShort, setPrimaryAlloyShort] = useState("14KT YG");
  const [primaryGramWt, setPrimaryGramWt] = useState(3.6);
  const [secondaryAlloyShort, setSecondaryAlloyShort] = useState("14KT WG-PD");
  const [secondaryGramWt, setSecondaryGramWt] = useState(0.5);
  const [rows, setRows] = useState(Array.from({ length: 12 }, emptyRow));
  const [savedQuotes, setSavedQuotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("jwyQuotes") || "[]");
    } catch {
      return [];
    }
  });
  const [pdfStatus, setPdfStatus] = useState(""); // "", "loading", "unmapped", "error", "done"
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfImport, setPdfImport] = useState(null);
  const [cadImage, setCadImage] = useState("");
  const [clientRefImage, setClientRefImage] = useState("");
  const [turntableLink, setTurntableLink] = useState("");

  // Live data: each table falls back independently to its bundled sample
  // if its sheet URL isn't configured or its fetch fails, so a typo in
  // one tab's URL never breaks the whole calculator.
  const [liveData, setLiveData] = useState({
    metalRates: SAMPLE_METAL_RATES,
    alloys: ALLOYS,
    currencyRates: SAMPLE_CURRENCY_RATES,
    currencyMarkup: 1.05,
    locations: LOCATIONS,
    laborPerGm: LABOR_PER_GM,
    laborMinFlat: LABOR_MIN_FLAT,
    cadFees: CAD_FEES,
    settingTiers: SETTING_TIERS,
  });
  const [tableSources, setTableSources] = useState({
    metalRates: "sample",
    alloys: "sample",
    currencyRates: "sample",
    locations: "sample",
    cadFeesAndLabor: "sample",
    settingTiers: "sample",
  });
  const [rateLoading, setRateLoading] = useState(false);
  const [rateErrors, setRateErrors] = useState({});
  const [lastSync, setLastSync] = useState(null);

  const refreshRates = useCallback(async () => {
    setRateLoading(true);
    try {
      const { data, errors } = await fetchLiveSheetData();
      setLiveData((prev) => ({
        metalRates: data.metalRates && Object.keys(data.metalRates).length ? data.metalRates : prev.metalRates,
        alloys: data.alloys && data.alloys.length ? data.alloys : prev.alloys,
        currencyRates:
          data.currencyRates && Object.keys(data.currencyRates.rates || {}).length
            ? data.currencyRates.rates
            : prev.currencyRates,
        currencyMarkup: data.currencyRates ? data.currencyRates.markup : prev.currencyMarkup,
        locations: data.locations && data.locations.length ? data.locations : prev.locations,
        laborPerGm: data.cadFeesAndLabor ? data.cadFeesAndLabor.laborPerGm : prev.laborPerGm,
        laborMinFlat: data.cadFeesAndLabor ? data.cadFeesAndLabor.laborMinFlat : prev.laborMinFlat,
        cadFees: data.cadFeesAndLabor ? data.cadFeesAndLabor.cadFees : prev.cadFees,
        settingTiers: data.settingTiers && data.settingTiers.length ? data.settingTiers : prev.settingTiers,
      }));
      setTableSources({
        metalRates: data.metalRates ? "live" : "sample",
        alloys: data.alloys ? "live" : "sample",
        currencyRates: data.currencyRates ? "live" : "sample",
        locations: data.locations ? "live" : "sample",
        cadFeesAndLabor: data.cadFeesAndLabor ? "live" : "sample",
        settingTiers: data.settingTiers ? "live" : "sample",
      });
      setRateErrors(errors);
      setLastSync(new Date());
    } catch (e) {
      setRateErrors({ all: e.message || String(e) });
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRates();
    const id = setInterval(refreshRates, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshRates]);

  // Shared by both import paths (PDF and direct JSON) -- applies a
  // successful parse result to calculator state identically either way.
  const applyImportResult = (fileName, resultData) => {
    const { jobInfo: ji, metals, metalWarnings, stones, cadImageDataUrl, clientRefImageDataUrl, derivedSummary } = resultData;
    if (cadImageDataUrl) setCadImage(cadImageDataUrl);
    if (clientRefImageDataUrl) setClientRefImage(clientRefImageDataUrl);

    // Apply job info. There's no true customer-name field on the card,
    // so we leave Customer untouched rather than stuffing Style code
    // into a field labeled "Customer name" -- job identifiers are
    // shown correctly labeled in the import review panel instead.
    setJobInfo((prev) => ({
      ...prev,
      designer: ji.designer || prev.designer,
      jobNo: ji.jobNo || prev.jobNo,
    }));

    // Apply metals (already weight-sorted: primary = heavier).
    if (metals.primary) {
      if (liveData.alloys.some((a) => a.short === metals.primary.short)) {
        setPrimaryAlloyShort(metals.primary.short);
      }
      setPrimaryGramWt(metals.primary.wt);
    }
    if (metals.secondary) {
      if (liveData.alloys.some((a) => a.short === metals.secondary.short)) {
        setSecondaryAlloyShort(metals.secondary.short);
      }
      setSecondaryGramWt(metals.secondary.wt);
    }

    // Apply stones -> calculator rows. Each row carries its own pricing
    // mode, so cards mixing mined and lab-grown stones import fully.
    const newRows = Array.from({ length: 12 }, emptyRow);
    stones.slice(0, 12).forEach((s, i) => {
      newRows[i] = {
        mode: s.diamondMode || "natural",
        shapeSel: s.isCustom ? CUSTOM_CODE : s.matchedShape || "",
        sizeCode: s.isCustom ? CUSTOM_CODE : s.sizeCode || "",
        quality: "TW SI1",
        lgdGrade: "Non-cert",
        lgdShape: s.lgdShape || "RND",
        pcs: s.qty ? String(s.qty) : "",
        customShape: s.customShape || "",
        customWt: s.customWt ? String(s.customWt) : "",
        customRate: "",
        manualRate: "",
      };
    });
    setRows(newRows);

    setPdfImport({
      fileName,
      jobInfo: ji,
      metalWarnings,
      metals,
      stones,
      derivedSummary,
    });
    setPdfStatus("done");
  };

  // Direct JSON import: no PDF, no pdf.js, no text-extraction truncation
  // risk. Reads the exact same JSON the CAD form embeds in its PDFs --
  // just fed in directly via a "Copy/Export Order Data" button on the
  // form instead of scraped back out of a rendered document.
  const handleJsonUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfStatus("loading");
    setPdfImport(null);
    try {
      const text = await file.text();
      const result = parseOrderFormJson(text, {
        alloys: liveData.alloys,
        diaSize: DIA_SIZE,
      });
      if (!result.ok) {
        setPdfStatus("error");
        setPdfImport({ error: result.diag || "Could not read this file" });
        return;
      }
      applyImportResult(file.name, result.data);
    } catch (err) {
      setPdfStatus("error");
      setPdfImport({ error: (err && err.message) || String(err) });
    }
  };

  const clearAll = () => {
    setJobInfo({ designer: "", jobNo: "", customer: "", cadType: "Medium" });
    setPrimaryGramWt(0);
    setSecondaryGramWt(0);
    setRows(Array.from({ length: 12 }, emptyRow));
    setPdfImport(null);
    setPdfStatus("");
    setPdfFileName("");
    setCadImage("");
    setClientRefImage("");
    setTurntableLink("");
  };

  const persistQuotes = (list) => {
    setSavedQuotes(list);
    try {
      localStorage.setItem("jwyQuotes", JSON.stringify(list));
    } catch {}
  };

  const saveQuote = () => {
    const snapshot = {
      id: Date.now(),
      label: `${jobInfo.jobNo || "no-job"} · ${quoteStage} · ${new Date().toLocaleString()}`,
      jobInfo,
      location,
      quoteStage,
      primaryAlloyShort,
      primaryGramWt,
      secondaryAlloyShort,
      secondaryGramWt,
      rows,
    };
    persistQuotes([snapshot, ...savedQuotes].slice(0, 50));
  };

  const loadQuote = (id) => {
    const q = savedQuotes.find((s) => s.id === id);
    if (!q) return;
    setJobInfo(q.jobInfo);
    setLocation(q.location);
    setQuoteStage(q.quoteStage || "Q1");
    setPrimaryAlloyShort(q.primaryAlloyShort);
    setPrimaryGramWt(q.primaryGramWt);
    setSecondaryAlloyShort(q.secondaryAlloyShort);
    setSecondaryGramWt(q.secondaryGramWt);
    setRows(q.rows.map((r) => ({ ...emptyRow(), ...r })));
  };

  const deleteQuote = (id) => {
    persistQuotes(savedQuotes.filter((s) => s.id !== id));
  };

  // Manual metal-rate override: if the live sheet ever drops (network
  // issue, sheet unpublished, anything), the person quoting should never
  // be stuck silently working off stale bundled sample numbers without
  // knowing it. Turning this on lets them type in today's actual rates
  // directly, which take priority over both live and sample data for as
  // long as it's on -- so the calculator keeps producing real quotes
  // regardless of what the sheet is doing.
  const [manualRatesOn, setManualRatesOn] = useState(false);
  const [manualRates, setManualRates] = useState(SAMPLE_METAL_RATES);

  const metalRates = manualRatesOn ? manualRates : liveData.metalRates;
  const toggleManualRates = () => {
    if (!manualRatesOn) {
      // Starting manual mode: pre-fill with whatever's currently showing
      // (live if connected, sample otherwise) so the person edits from a
      // sensible baseline instead of a blank form.
      setManualRates(liveData.metalRates);
    }
    setManualRatesOn(!manualRatesOn);
  };
  const alloyList = liveData.alloys;
  const currencyRates = liveData.currencyRates;
  const locationList = liveData.locations;
  const settingTiersLive = liveData.settingTiers;

  const primaryAlloy = alloyList.find((a) => a.short === primaryAlloyShort) || alloyList[0];
  const secondaryAlloy = alloyList.find((a) => a.short === secondaryAlloyShort) || alloyList[0];
  const totalGramWt = (parseFloat(primaryGramWt) || 0) + (parseFloat(secondaryGramWt) || 0);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // Adds a new row pre-set to Custom entry mode -- lands with free-text
  // shape/weight/rate inputs ready to fill in immediately, for stones
  // that don't match anything in the catalog (colored gems, one-offs,
  // anything the "Add row" button is meant for) rather than requiring
  // the user to also manually switch the Shape dropdown to "Custom".
  const addCustomRow = () => {
    setRows((prev) => [...prev, { ...emptyRow(), shapeSel: CUSTOM_CODE, sizeCode: CUSTOM_CODE }]);
  };

  const removeRow = (idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const rowCalcs = useMemo(() => {
    return rows.map((row) => {
      const pcs = parseFloat(row.pcs) || 0;
      if (row.sizeCode === CUSTOM_CODE) {
        const wtPerPc = parseFloat(row.customWt) || 0;
        const perCt = parseFloat(row.customRate) || 0;
        const totalWt = wtPerPc * pcs;
        const tier = settingRateFor(wtPerPc, settingTiersLive);
        const settingTotal = pcs > 0 ? (tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs) : 0;
        return {
          shape: row.customShape || "Custom",
          size: "manual entry",
          wtPerPc,
          totalWt,
          perCt,
          total: totalWt * perCt,
          settingTotal,
          settingType: tier.type,
          priceEditable: true,
        };
      }
      const sizeEntry = DIA_SIZE.find((d) => d.key === row.sizeCode);
      if (!sizeEntry || pcs <= 0) {
        return { shape: "", size: "", wtPerPc: 0, totalWt: 0, perCt: 0, total: 0, settingTotal: 0, settingType: "PER PC", priceEditable: false };
      }
      const totalWt = sizeEntry.wt * pcs;
      const isNatural = (row.mode || "natural") === "natural";

      let perCt = 0;
      let priceEditable = false;
      if (isNatural) {
        if (sizeEntry.group) {
          // Round natural: priced from the DiaSSP grid.
          const grid = DIA_SSP[sizeEntry.group];
          perCt = grid?.[row.quality] || 0;
        } else {
          // Fancy natural: no DiaSSP price for this shape yet. The rate
          // is a manually-entered value on this row, same mechanism as
          // a custom row, but the shape/size stay catalog-matched.
          perCt = parseFloat(row.manualRate) || 0;
          priceEditable = true;
        }
      } else {
        // LGD prices from the FANCY/ODD/cert bands regardless of
        // whether the matched size entry has a DiaSSP group -- LGD
        // pricing never depends on that grid.
        const wtPerPc = sizeEntry.wt;
        if (wtPerPc < 0.01 || row.lgdGrade === "Non-cert") {
          const band = LGD_NONCERT.find((b) => wtPerPc >= b.minCt && wtPerPc <= b.maxCt);
          perCt = band?.rate || 0;
        } else {
          const band = LGD_CERT.find(
            (b) => (b.shape === row.lgdShape || b.shape === "RND & FANCY") && wtPerPc >= b.minCt && wtPerPc <= b.maxCt
          );
          if (band) {
            if (row.lgdGrade === "Lab VS") perCt = band.labVS || 0;
            else if (row.lgdGrade === "D/VVS2") perCt = band.dvvs2 || 0;
            else if (row.lgdGrade === "D/VS1") perCt = band.dvs1 || 0;
          }
        }
      }

      const total = totalWt * perCt;
      const tier = settingRateFor(sizeEntry.wt, settingTiersLive);
      const settingTotal = tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs;

      return {
        shape: sizeEntry.shape,
        size: sizeEntry.size,
        wtPerPc: sizeEntry.wt,
        totalWt,
        perCt,
        total,
        settingTotal,
        settingType: tier.type,
        priceEditable,
      };
    });
  }, [rows, settingTiersLive]);

  const totals = useMemo(() => {
    const totalWt = rowCalcs.reduce((s, r) => s + r.totalWt, 0);
    const totalPcs = rows.reduce((s, r) => s + (parseFloat(r.pcs) || 0), 0);
    // Dollar figures round to the nearest 5; weight/piece-count fields
    // don't (rounding carats to a multiple of 5 would be meaningless).
    const diamondTotal = roundUp5(rowCalcs.reduce((s, r) => s + r.total, 0));
    const settingTotal = roundUp5(rowCalcs.reduce((s, r) => s + r.settingTotal, 0));
    return { totalWt, totalPcs, diamondTotal, settingTotal };
  }, [rowCalcs, rows]);

  const casting = useMemo(() => {
    const primaryCost = castingCost(parseFloat(primaryGramWt) || 0, primaryAlloy, metalRates);
    const secondaryCost = castingCost(parseFloat(secondaryGramWt) || 0, secondaryAlloy, metalRates);
    return roundUp5(primaryCost + secondaryCost);
  }, [primaryAlloy, secondaryAlloy, primaryGramWt, secondaryGramWt, metalRates]);

  const labor = useMemo(() => {
    const perGm = totalGramWt * liveData.laborPerGm;
    return roundUp5(Math.max(perGm, liveData.laborMinFlat));
  }, [totalGramWt, liveData.laborPerGm, liveData.laborMinFlat]);

  // CAD fees (None/Simple/Medium/Complex/Advanced: $0/$50/$75/$100/$200)
  // are already always multiples of 5 -- roundUp5 here is a no-op on
  // those exact values, just a defensive guard if that table ever gets
  // a non-round number added to it later.
  const cadFee = roundUp5(liveData.cadFees[jobInfo.cadType] ?? 0);
  // Every piece above is already a multiple of 5, so this sum is too --
  // the grand total is built FROM the rounded line items, not rounded
  // separately, which is what keeps the displayed breakdown adding up
  // exactly to the displayed total.
  const grossTotalUSD = casting + labor + cadFee + totals.diamondTotal + totals.settingTotal;
  const locInfo = locationList.find((l) => l.code === location) || locationList[0];
  const fxRate = (currencyRates[locInfo.currency] || 1) * liveData.currencyMarkup;
  // Only the final, customer-facing prices get rounded up to the nearest
  // $5 -- the internal gross total stays exact so duty math and the
  // percentage breakdown remain accurate against real figures, not a
  // rounded approximation.
  const totalWithDutyUSD = roundUp5(grossTotalUSD * (1 + locInfo.duty));
  const totalWithDutyLocal = roundUp5(totalWithDutyUSD * fxRate);
  const sspCode = sspEncode(totalWithDutyUSD);
  const breakupPct = (val) => (grossTotalUSD > 0 ? (val / grossTotalUSD) * 100 : 0);

  const [printVariant, setPrintVariant] = useState(null);
  const doPrint = (variant) => {
    setPrintVariant(variant);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintVariant(null), 400);
    }, 80);
  };

  return (
    <div style={styles.app}>
      <GlobalStyles />
      <div className="print-only">
        <PrintQuote
          variant={printVariant || "full"}
          jobInfo={jobInfo}
          locInfo={locInfo}
          primaryAlloy={primaryAlloy}
          primaryGramWt={primaryGramWt}
          secondaryAlloy={secondaryAlloy}
          secondaryGramWt={secondaryGramWt}
          rows={rows}
          rowCalcs={rowCalcs}
          totals={totals}
          casting={casting}
          labor={labor}
          cadFee={cadFee}
          grossTotalUSD={grossTotalUSD}
          totalWithDutyUSD={totalWithDutyUSD}
          totalWithDutyLocal={totalWithDutyLocal}
          fxRate={fxRate}
          sspCode={sspCode}
          cadImage={cadImage}
          clientRefImage={clientRefImage}
          turntableLink={turntableLink}
          quoteStage={quoteStage}
        />
      </div>
      <div className="screen-only">
      <TopBar
        jobInfo={jobInfo}
        pdfFileName={pdfFileName}
        pdfStatus={pdfStatus}
        pdfImport={pdfImport}
        onJsonUpload={handleJsonUpload}
        onClear={clearAll}
      />

      <div style={styles.shell}>
        <JobInfoCard
          jobInfo={jobInfo}
          setJobInfo={setJobInfo}
          location={location}
          setLocation={setLocation}
          locationList={locationList}
          cadFees={liveData.cadFees}
          turntableLink={turntableLink}
          setTurntableLink={setTurntableLink}
        />

        {pdfImport && <PdfImportReview pdfImport={pdfImport} />}

        <RatesStatusCard
          tableSources={tableSources}
          rateLoading={rateLoading}
          rateErrors={rateErrors}
          refreshRates={refreshRates}
          metalRates={metalRates}
          totalGramWt={totalGramWt}
          lastSync={lastSync}
          manualRatesOn={manualRatesOn}
          onToggleManual={toggleManualRates}
          manualRates={manualRates}
          setManualRates={setManualRates}
        />

        <div style={styles.grid2}>
          <MetalPanel
            title="Primary metal"
            alloyShort={primaryAlloyShort}
            setAlloyShort={setPrimaryAlloyShort}
            alloyList={alloyList}
            gramWt={primaryGramWt}
            setGramWt={setPrimaryGramWt}
          />
          <MetalPanel
            title="Secondary metal"
            alloyShort={secondaryAlloyShort}
            setAlloyShort={setSecondaryAlloyShort}
            alloyList={alloyList}
            gramWt={secondaryGramWt}
            setGramWt={setSecondaryGramWt}
          />
        </div>

        <StoneGrid rows={rows} updateRow={updateRow} rowCalcs={rowCalcs} totals={totals} onAddRow={addCustomRow} onRemoveRow={removeRow} />

        <QuotesToolbar
          savedQuotes={savedQuotes}
          onSave={saveQuote}
          onLoad={loadQuote}
          onDelete={deleteQuote}
          onPrint={doPrint}
          quoteStage={quoteStage}
          setQuoteStage={setQuoteStage}
        />

        <BreakupSummary
          casting={casting}
          labor={labor}
          cadFee={cadFee}
          cadType={jobInfo.cadType}
          diamondTotal={totals.diamondTotal}
          settingTotal={totals.settingTotal}
          grossTotalUSD={grossTotalUSD}
          locInfo={locInfo}
          fxRate={fxRate}
          totalWithDutyUSD={totalWithDutyUSD}
          totalWithDutyLocal={totalWithDutyLocal}
          breakupPct={breakupPct}
          sspCode={sspCode}
        />
      </div>
      </div>
    </div>
  );
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */


function PrintQuote({
  variant, jobInfo, locInfo, primaryAlloy, primaryGramWt, secondaryAlloy, secondaryGramWt,
  rows, rowCalcs, totals, casting, labor, cadFee, grossTotalUSD, totalWithDutyUSD,
  totalWithDutyLocal, fxRate, sspCode, cadImage, clientRefImage, turntableLink, quoteStage,
}) {
  const showPrices = variant === "full";
  const activeRows = rows
    .map((r, i) => ({ r, c: rowCalcs[i], i }))
    .filter(({ r, c }) => (r.sizeCode || r.customShape) && c.totalWt > 0);

  const ROSE = "#9C4A63";
  const INK = "#241B1E";
  const MUTED = "#7A6870";
  const HAIRLINE = "#E8D9DE";

  const cell = { padding: "8px 10px", fontSize: 12, color: INK, borderBottom: `1px solid ${HAIRLINE}` };
  const cellR = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const hd = {
    padding: "8px 10px",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#fff",
    background: ROSE,
  };
  const hdR = { ...hd, textAlign: "right" };

  return (
    <div style={{ fontFamily: '"Inter", Arial, sans-serif', color: INK }}>
      {/* Repeating header/footer -- position:fixed inside @media print
          makes these reappear on every physical printed page (Chrome
          and Chromium-based browsers render fixed elements per-page
          when printing). Kept small and unobtrusive per spec. */}
      <div className="print-fixed-header">
        <img src={WS_LOGO} alt="World Shiner" style={{ height: 22 }} />
        <span style={{ fontSize: 10, color: MUTED, letterSpacing: 0.4 }}>JWY Calculator</span>
      </div>
      <div className="print-fixed-footer">
        <img src={WS_LOGO} alt="" style={{ height: 12, opacity: 0.7 }} />
        <span>World Shiner · {showPrices ? "Internal Quotation" : "Design Reference"}</span>
      </div>

      <div style={{ padding: "30px 34px", maxWidth: 780, margin: "0 auto" }}>
      {/* ---- Letterhead ---- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: `3px solid ${ROSE}`,
          paddingBottom: 14,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={WS_LOGO} alt="World Shiner" style={{ height: 40, width: "auto" }} />
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: MUTED, marginBottom: 2 }}>
              World Shiner — Fine Jewelry Manufacturing
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: '"Playfair Display", Georgia, serif' }}>
              {showPrices ? "Quotation" : "Design Reference"}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
              {showPrices ? "Prepared for internal / trade use" : "Customer-facing — pricing withheld"}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
          <div>
            <b style={{ color: INK }}>Job:</b> {jobInfo.jobNo || "—"}
            {quoteStage && (
              <span style={{ marginLeft: 8, background: ROSE, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10 }}>
                {quoteStage}
              </span>
            )}
          </div>
          <div>
            <b style={{ color: INK }}>Designer:</b> {jobInfo.designer || "—"}
          </div>
          <div>
            <b style={{ color: INK }}>Date:</b> {new Date().toLocaleDateString()}
          </div>
          {jobInfo.customer && (
            <div>
              <b style={{ color: INK }}>Customer:</b> {jobInfo.customer}
            </div>
          )}
        </div>
      </div>

      {/* ---- Design presentation: images up front, as a manufacturer would lead with the render ---- */}
      {(cadImage || clientRefImage) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 20, breakInside: "avoid" }}>
          {cadImage && (
            <div style={{ flex: "1 1 50%" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED, marginBottom: 5 }}>
                CAD Render
              </div>
              <img
                src={cadImage}
                alt="CAD render"
                style={{ width: "100%", maxHeight: 260, objectFit: "contain", border: `1px solid ${HAIRLINE}`, borderRadius: 6, background: "#fff" }}
              />
            </div>
          )}
          {clientRefImage && (
            <div style={{ flex: "1 1 50%" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED, marginBottom: 5 }}>
                Client Reference
              </div>
              <img
                src={clientRefImage}
                alt="Client reference"
                style={{ width: "100%", maxHeight: 260, objectFit: "contain", border: `1px solid ${HAIRLINE}`, borderRadius: 6, background: "#fff" }}
              />
            </div>
          )}
        </div>
      )}

      {turntableLink && (
        <div style={{ fontSize: 12, marginBottom: 18 }}>
          <b>3D render / turntable: </b>
          <a href={turntableLink} style={{ color: ROSE }}>
            {turntableLink}
          </a>
        </div>
      )}

      {/* ---- Job specification ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          border: `1px solid ${HAIRLINE}`,
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 20,
          breakInside: "avoid",
        }}
      >
        {[
          ["Primary metal", primaryAlloy ? `${primaryAlloy.short} · ${fmt(parseFloat(primaryGramWt) || 0, 2)}g` : "—"],
          [
            "Secondary metal",
            secondaryAlloy && (parseFloat(secondaryGramWt) || 0) > 0
              ? `${secondaryAlloy.short} · ${fmt(parseFloat(secondaryGramWt) || 0, 2)}g`
              : "—",
          ],
          ["CAD complexity", jobInfo.cadType || "—"],
          ["Ship-to location", `${locInfo.code} (${locInfo.currency})`],
        ].map(([label, val], i) => (
          <div key={label} style={{ padding: "10px 12px", borderLeft: i === 0 ? "none" : `1px solid ${HAIRLINE}`, background: i % 2 ? "#FBF5F7" : "#fff" }}>
            <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ---- Stone schedule ---- */}
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ROSE, marginBottom: 6 }}>
        Stone Schedule
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, breakInside: "avoid" }}>
        <thead>
          <tr>
            <th style={hd}>Pos</th>
            <th style={hd}>Type</th>
            <th style={hd}>Shape / Size</th>
            <th style={hdR}>Qty</th>
            <th style={hdR}>Total Ct</th>
            {showPrices && <th style={hdR}>$/Ct</th>}
            {showPrices && <th style={hdR}>$ Total</th>}
          </tr>
        </thead>
        <tbody>
          {activeRows.map(({ r, c, i }, idx) => (
            <tr key={i} style={{ background: idx % 2 ? "#FBF5F7" : "#fff" }}>
              <td style={cell}>{i + 1}</td>
              <td style={cell}>{(r.mode || "natural") === "lgd" ? "Lab grown" : "Mined"}</td>
              <td style={cell}>
                {c.shape} · {c.size}
              </td>
              <td style={cellR}>{r.pcs}</td>
              <td style={cellR}>{fmt(c.totalWt, 3)}</td>
              {showPrices && <td style={cellR}>{fmtCurrency(c.perCt)}</td>}
              {showPrices && <td style={cellR}>{fmtCurrency(c.total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- Totals ---- */}
      {showPrices ? (
        <div style={{ display: "flex", justifyContent: "flex-end", breakInside: "avoid" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 320 }}>
            <tbody>
              {[
                ["Casting", casting],
                ["Labor", labor],
                [`CAD (${jobInfo.cadType})`, cadFee],
                ["Diamonds", totals.diamondTotal],
                ["Setting", totals.settingTotal],
              ].map(([label, val]) => (
                <tr key={label}>
                  <td style={{ ...cell, border: "none" }}>{label}</td>
                  <td style={{ ...cellR, border: "none" }}>{fmtCurrency(val)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...cell, border: "none", borderTop: `1px solid ${HAIRLINE}`, fontWeight: 700 }}>
                  Gross total (USD)
                </td>
                <td style={{ ...cellR, border: "none", borderTop: `1px solid ${HAIRLINE}`, fontWeight: 700 }}>
                  {fmtCurrency(grossTotalUSD)}
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, border: "none" }}>With {(locInfo.duty * 100).toFixed(0)}% duty (USD)</td>
                <td style={{ ...cellR, border: "none" }}>{fmtCurrency(totalWithDutyUSD)}</td>
              </tr>
              <tr>
                <td style={{ padding: "10px", background: ROSE, color: "#fff", fontWeight: 700, borderRadius: "6px 0 0 6px" }}>
                  {locInfo.code} total ({locInfo.currency}, fx {fmt(fxRate, 3)})
                </td>
                <td
                  style={{
                    padding: "10px",
                    background: ROSE,
                    color: "#fff",
                    fontWeight: 700,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    borderRadius: "0 6px 6px 0",
                  }}
                >
                  {fmtCurrency(totalWithDutyLocal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: "right", marginTop: 10, breakInside: "avoid" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8, color: MUTED }}>Reference Code</div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 5, color: ROSE }}>{sspCode}</div>
        </div>
      )}

      <div style={{ marginTop: 26, paddingTop: 12, borderTop: `1px solid ${HAIRLINE}`, fontSize: 9.5, color: MUTED, textAlign: "center" }}>
        {showPrices ? `SSP ${sspCode} · ` : ""}Generated {new Date().toLocaleString()}
      </div>
      </div>
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      input, select { font-family: inherit; }
      input:focus, select:focus { outline: 2px solid #9C4A63; outline-offset: -1px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; }
      ::-webkit-scrollbar { height: 8px; width: 8px; }
      ::-webkit-scrollbar-thumb { background: #E3C3CD; border-radius: 4px; }
      .print-only { display: none; }
      .print-fixed-header, .print-fixed-footer { display: none; }
      @media print {
        .screen-only { display: none !important; }
        .print-only { display: block !important; }
        @page { margin: 16mm 12mm 14mm; }
        img { max-width: 100%; }
        tr { break-inside: avoid; }

        .print-fixed-header {
          display: flex;
          align-items: center;
          gap: 8px;
          position: fixed;
          top: -12mm;
          left: 0;
          right: 0;
          padding-bottom: 4px;
          border-bottom: 1px solid #E8D9DE;
        }
        .print-fixed-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          position: fixed;
          bottom: -10mm;
          left: 0;
          right: 0;
          font-size: 8.5px;
          color: #9C8A92;
          padding-top: 3px;
          border-top: 1px solid #E8D9DE;
        }
      }
    `}</style>
  );
}

function TopBar({ jobInfo, pdfFileName, pdfStatus, pdfImport, onJsonUpload, onClear }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.topBarInner}>
        <div style={styles.brandBlock}>
          <img src={WS_LOGO} alt="World Shiner" style={{ height: 34, width: "auto" }} />
          <div>
            <div style={styles.brandTitle}>JWY Calculator</div>
            <div style={styles.brandSub}>Job {jobInfo.jobNo || "—"}</div>
          </div>
        </div>
        <div style={styles.topBarActions}>
          <button style={styles.uploadBtn} onClick={onClear} type="button">
            Clear form
          </button>
          <label style={styles.uploadBtn} title="Import the .json exported by the CAD Order Form's Export Order Data button">
            <i className="ti ti-file-upload" aria-hidden="true" style={{ fontSize: 15, marginRight: 6 }} />
            Load order data
            <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onJsonUpload} />
          </label>
        </div>
      </div>
      {pdfFileName && (
        <div style={styles.pdfStatusBar}>
          {pdfStatus === "loading" && <>Reading {pdfFileName}…</>}
          {pdfStatus === "done" && <>Imported {pdfFileName} — job, metals, and stones populated below. Review flagged rows.</>}
          {pdfStatus === "error" && (
            <>Couldn't read {pdfFileName}. {pdfImport && pdfImport.error ? `Error: ${pdfImport.error}` : "Make sure it's a .json file exported from the CAD Order Form."}</>
          )}
        </div>
      )}
    </div>
  );
}

function PdfImportReview({ pdfImport }) {
  if (pdfImport.error) {
    return (
      <div style={styles.card}>
        <SectionLabel eyebrow="!" title="CAD import error" />
        <div style={styles.warnBanner}>{pdfImport.error}</div>
      </div>
    );
  }
  const { jobInfo: ji, metals, metalWarnings, stones, derivedSummary } = pdfImport;
  const flagged = stones.filter((s) => s.flag);
  const ds = derivedSummary || {};
  const hasDerivedSummary = ds.metalTypeCombined || ds.metalColorCombined || ds.stoneTypes || ds.stoneSources || ds.stoneSettings;
  return (
    <div style={{ ...styles.card, borderColor: "#C9A35C", borderWidth: 1 }}>
      <SectionLabel eyebrow="↓" title="Imported from CAD card — review" />
      <div style={styles.importMetaRow}>
        {ji && ji.jobNo && <span style={styles.importChip}>Job {ji.jobNo}</span>}
        {ji && ji.styleCode && <span style={styles.importChip}>Style/SKU {ji.styleCode}</span>}
        {ji && ji.itemNo && <span style={styles.importChip}>Item {ji.itemNo}</span>}
        {metals.primary && (
          <span style={styles.importChip}>
            Primary: {metals.primary.short} · {fmt(metals.primary.wt, 2)}g
          </span>
        )}
        {metals.secondary && (
          <span style={styles.importChip}>
            Secondary: {metals.secondary.short} · {fmt(metals.secondary.wt, 2)}g
          </span>
        )}
        <span style={styles.importChip}>{stones.length} stone row(s)</span>
      </div>

      {hasDerivedSummary && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          Form's own summary — cross-check only, not used for pricing:{" "}
          {[
            ds.metalTypeCombined && `metal ${ds.metalTypeCombined}`,
            ds.metalColorCombined && `color ${ds.metalColorCombined}`,
            ds.stoneQty && `${ds.stoneQty} pcs`,
            ds.stoneTypes && `types: ${ds.stoneTypes}`,
            ds.stoneSources && `sources: ${ds.stoneSources}`,
            ds.stoneSettings && `settings: ${ds.stoneSettings}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      {(metalWarnings.length > 0 || flagged.length > 0) && (
        <div style={styles.warnBanner}>
          {metalWarnings.map((w, i) => (
            <div key={"mw" + i}>• {w}</div>
          ))}
          {flagged.map((s, i) => (
            <div key={"sf" + i}>
              • {s.pos} {s.shape} ({s.stoneType}): {s.flag}
            </div>
          ))}
        </div>
      )}

      <table style={styles.table}>
        <thead>
          <tr style={styles.theadRow}>
            <th style={styles.th}>Pos</th>
            <th style={styles.th}>Stone</th>
            <th style={styles.th}>Shape</th>
            <th style={styles.th}>Dims</th>
            <th style={styles.th}>Col</th>
            <th style={styles.th}>Clar</th>
            <th style={styles.thRight}>Avg ct</th>
            <th style={styles.thRight}>Qty</th>
            <th style={styles.thRight}>Total ct</th>
            <th style={styles.th}>Mapped to</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {stones.map((s, i) => (
            <tr key={i} style={styles.tr}>
              <td style={styles.td}>{s.pos}</td>
              <td style={styles.td}>{s.stoneType}</td>
              <td style={styles.td}>{s.shape}</td>
              <td style={{ ...styles.td, color: "var(--muted)", fontSize: 12 }}>{s.dims}</td>
              <td style={styles.td}>{s.col || "—"}</td>
              <td style={styles.td}>{s.clar || "—"}</td>
              <td style={styles.tdRight}>{fmt(s.avgWt, 4)}</td>
              <td style={styles.tdRight}>{s.qty}</td>
              <td style={styles.tdRight}>{fmt(s.totalWt, 3)}</td>
              <td style={styles.td}>{s.sizeCode || "—"}</td>
              <td style={styles.td}>
                {s.flag ? (
                  <span style={styles.flagPill}>flag</span>
                ) : (
                  <span style={styles.okPill}>priced</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobInfoCard({ jobInfo, setJobInfo, location, setLocation, locationList, cadFees, turntableLink, setTurntableLink }) {
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="01" title="Job details" />
      <div style={styles.fieldRow}>
        <Field label="Designer">
          <input
            style={styles.input}
            placeholder="e.g. Sudip"
            value={jobInfo.designer}
            onChange={(e) => setJobInfo({ ...jobInfo, designer: e.target.value })}
          />
        </Field>
        <Field label="Job #">
          <input
            style={styles.input}
            placeholder="e.g. 4376"
            value={jobInfo.jobNo}
            onChange={(e) => setJobInfo({ ...jobInfo, jobNo: e.target.value })}
          />
        </Field>
        <Field label="Customer" grow>
          <input
            style={styles.input}
            placeholder="Customer name"
            value={jobInfo.customer}
            onChange={(e) => setJobInfo({ ...jobInfo, customer: e.target.value })}
          />
        </Field>
        <Field label="CAD type">
          <select
            style={styles.input}
            value={jobInfo.cadType}
            onChange={(e) => setJobInfo({ ...jobInfo, cadType: e.target.value })}
          >
            {Object.keys(cadFees).map((k) => (
              <option key={k} value={k}>
                {k} (${cadFees[k]})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <select style={styles.input} value={location} onChange={(e) => setLocation(e.target.value)}>
            {locationList.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} · {l.currency} · {(l.duty * 100).toFixed(0)}% duty
              </option>
            ))}
          </select>
        </Field>
        <Field label="3D render link (optional)" grow>
          <input
            style={styles.input}
            placeholder="https://sketchfab.com/... or turntable video URL"
            value={turntableLink}
            onChange={(e) => setTurntableLink(e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function RatesStatusCard({
  tableSources,
  rateLoading,
  rateErrors,
  refreshRates,
  metalRates,
  totalGramWt,
  lastSync,
  manualRatesOn,
  onToggleManual,
  manualRates,
  setManualRates,
}) {
  const allLive = Object.values(tableSources).every((s) => s === "live");
  const anyLive = Object.values(tableSources).some((s) => s === "live");
  const errorList = Object.entries(rateErrors || {}).filter(([, v]) => v);

  const updateManualMetal = (code, field, value) => {
    setManualRates((prev) => ({
      ...prev,
      [code]: { ...prev[code], [field]: field === "label" || field === "asOf" ? value : parseFloat(value) || 0 },
    }));
  };

  return (
    <div style={styles.card}>
      <div style={styles.rowBetween}>
        <SectionLabel eyebrow="02" title="Live data sync" />
        <div style={styles.rateStatus}>
          <span
            style={{
              ...styles.dot,
              background: manualRatesOn ? "#3B6EA8" : allLive ? "#3F8F5F" : anyLive ? "#B5651D" : "#9B8088",
            }}
          />
          {manualRatesOn
            ? "Metal rates entered manually"
            : rateLoading
            ? "Syncing…"
            : allLive
            ? "All sheets connected"
            : anyLive
            ? "Partially connected"
            : "Using bundled sample data"}
          <button style={styles.smallBtn} onClick={refreshRates} disabled={rateLoading}>
            Sync now
          </button>
        </div>
      </div>
      <div style={styles.tableSourceRow}>
        {Object.entries(tableSources).map(([k, v]) => (
          <span key={k} style={{ ...styles.sourcePill, ...(v === "live" ? styles.sourcePillLive : {}) }}>
            {k}
          </span>
        ))}
      </div>
      {lastSync && <div style={styles.syncNote}>Last synced {lastSync.toLocaleTimeString()}</div>}
      {errorList.length > 0 && !manualRatesOn && (
        <div style={styles.warnBanner}>
          {errorList.map(([k, v]) => (
            <div key={k}>
              {k}: {v === "not configured" ? "no sheet URL set in config.js, using bundled sample data" : v}
            </div>
          ))}
          {tableSources.metalRates !== "live" && (
            <div style={{ marginTop: 6 }}>
              Metal rates aren't live right now — use "Enter rates manually" below so quotes keep using real
              numbers instead of the bundled sample data.
            </div>
          )}
        </div>
      )}

      <div style={styles.rowBetween}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Precious metal rates</span>
        <button
          style={{ ...styles.smallBtn, ...(manualRatesOn ? styles.toggleBtnActive : {}) }}
          onClick={onToggleManual}
          type="button"
        >
          {manualRatesOn ? "Back to live/sample" : "Enter rates manually"}
        </button>
      </div>

      <table style={styles.table}>
        <thead>
          <tr style={styles.theadRow}>
            <th style={styles.th}>Metal</th>
            <th style={styles.th}>As on</th>
            <th style={styles.thRight}>PM rate/oz</th>
            <th style={styles.thRight}>Spot rate/oz</th>
            {manualRatesOn && <th style={styles.thRight}>Wastage</th>}
          </tr>
        </thead>
        <tbody>
          {manualRatesOn
            ? Object.entries(manualRates).map(([code, r]) => (
                <tr key={code} style={styles.tr}>
                  <td style={styles.td}>{r.label || code}</td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.inputSm, width: 110 }}
                      value={r.asOf || ""}
                      placeholder="e.g. today's date"
                      onChange={(e) => updateManualMetal(code, "asOf", e.target.value)}
                    />
                  </td>
                  <td style={styles.tdRight}>
                    <input
                      style={{ ...styles.inputSm, width: 80, textAlign: "right" }}
                      type="number"
                      step="0.01"
                      value={r.pmRateOz}
                      onChange={(e) => updateManualMetal(code, "pmRateOz", e.target.value)}
                    />
                  </td>
                  <td style={styles.tdRight}>
                    <input
                      style={{ ...styles.inputSm, width: 80, textAlign: "right" }}
                      type="number"
                      step="0.01"
                      value={r.spotOz}
                      onChange={(e) => updateManualMetal(code, "spotOz", e.target.value)}
                    />
                  </td>
                  <td style={styles.tdRight}>
                    <input
                      style={{ ...styles.inputSm, width: 60, textAlign: "right" }}
                      type="number"
                      step="0.001"
                      value={r.wastage}
                      onChange={(e) => updateManualMetal(code, "wastage", e.target.value)}
                    />
                  </td>
                </tr>
              ))
            : Object.entries(metalRates).map(([code, r]) => (
                <tr key={code} style={styles.tr}>
                  <td style={styles.td}>{r.label || code}</td>
                  <td style={{ ...styles.td, color: "var(--muted)" }}>{r.asOf}</td>
                  <td style={styles.tdRight}>{fmtCurrency(r.pmRateOz)}</td>
                  <td style={styles.tdRight}>{fmtCurrency(r.spotOz)}</td>
                </tr>
              ))}
        </tbody>
      </table>
      {manualRatesOn && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          These values are used for every casting calculation while manual mode is on. Switching back to
          "live/sample" discards them — re-enter if you turn manual mode on again later.
        </div>
      )}
      <div style={styles.totalGramNote}>Total gram weight: {fmt(totalGramWt, 3)} g</div>
    </div>
  );
}

function MetalPanel({ title, alloyShort, setAlloyShort, alloyList, gramWt, setGramWt }) {
  return (
    <div style={styles.card}>
      <div style={styles.panelTitle}>{title}</div>
      <div style={styles.fieldRow}>
        <Field label="Alloy" grow>
          <select style={styles.input} value={alloyShort} onChange={(e) => setAlloyShort(e.target.value)}>
            {alloyList.map((a) => (
              <option key={a.short} value={a.short}>
                {a.short} — {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gram wt">
          <input
            style={{ ...styles.input, width: 90 }}
            type="number"
            step="0.001"
            placeholder="0.00"
            value={gramWt}
            onChange={(e) => setGramWt(e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function QuotesToolbar({ savedQuotes, onSave, onLoad, onDelete, onPrint, quoteStage, setQuoteStage }) {
  const [selected, setSelected] = useState("");
  return (
    <div style={{ ...styles.card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <SectionLabel eyebrow="04" title="Quotes" noMargin />
      <select style={{ ...styles.input, width: 90 }} value={quoteStage} onChange={(e) => setQuoteStage(e.target.value)} title="Which round of quoting this is">
        <option value="Q1">Q1</option>
        <option value="Q2">Q2</option>
        <option value="Q3">Q3</option>
        <option value="Q4">Q4</option>
      </select>
      <button style={styles.toggleBtn} onClick={onSave} type="button">
        Save current quote
      </button>
      <select
        style={{ ...styles.input, minWidth: 220 }}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Saved quotes…</option>
        {savedQuotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button
        style={styles.toggleBtn}
        type="button"
        disabled={!selected}
        onClick={() => selected && onLoad(Number(selected))}
      >
        Load
      </button>
      <button
        style={styles.toggleBtn}
        type="button"
        disabled={!selected}
        onClick={() => {
          if (selected) {
            onDelete(Number(selected));
            setSelected("");
          }
        }}
      >
        Delete
      </button>
      <button style={{ ...styles.toggleBtn, ...styles.toggleBtnActive }} onClick={() => onPrint("full")} type="button">
        Print (full prices)
      </button>
      <button style={{ ...styles.toggleBtn, ...styles.toggleBtnActive }} onClick={() => onPrint("ssp")} type="button">
        Print with SSP only
      </button>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>
        Saved on this device (browser storage) — clearing browser data removes them.
      </span>
    </div>
  );
}

function StoneGrid({ rows, updateRow, rowCalcs, totals, onAddRow, onRemoveRow }) {
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="03" title="Stone schedule" />
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.theadRow}>
              <th style={styles.th}>Pos</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Shape</th>
              <th style={styles.th}>Size</th>
              <th style={styles.th}>Spec</th>
              <th style={styles.th}>Quality</th>
              <th style={styles.thRight}>Wt/pc</th>
              <th style={styles.thRight}>Pcs</th>
              <th style={styles.thRight}>Total wt</th>
              <th style={styles.thRight}>$/ct</th>
              <th style={styles.thRight}>$ total</th>
              <th style={styles.thRight}>$ setting</th>
              <th style={styles.th}>Rate</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const calc = rowCalcs[i];
              const active = !!row.sizeCode && (parseFloat(row.pcs) || 0) > 0;
              return (
                <tr key={i} style={{ ...styles.tr, ...(active ? styles.trActive : {}) }}>
                  <td style={styles.td}>
                    <span style={{ ...styles.posBadge, ...(active ? styles.posBadgeActive : {}) }}>{i + 1}</span>
                  </td>
                  <td style={styles.td}>
                    <select
                      style={{ ...styles.inputSm, width: 74 }}
                      value={row.mode || "natural"}
                      onChange={(e) => updateRow(i, { mode: e.target.value })}
                    >
                      <option value="natural">Mined</option>
                      <option value="lgd">Lab grown</option>
                    </select>
                  </td>
                  <td style={styles.td}>
                    <select
                      style={styles.inputSm}
                      value={row.shapeSel || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === CUSTOM_CODE) {
                          updateRow(i, { shapeSel: CUSTOM_CODE, sizeCode: CUSTOM_CODE });
                        } else {
                          updateRow(i, { shapeSel: val, sizeCode: "", customShape: "", customWt: "", customRate: "" });
                        }
                      }}
                    >
                      <option value="">Select shape</option>
                      {SHAPE_ORDER.map((shapeName) => {
                        const hasEntries = DIA_SIZE.some((d) => d.shape === shapeName);
                        if (!hasEntries) return null;
                        return (
                          <option key={shapeName} value={shapeName}>
                            {shapeName}
                          </option>
                        );
                      })}
                      <option value={CUSTOM_CODE}>Custom entry…</option>
                    </select>
                  </td>
                  <td style={styles.td}>
                    {!row.shapeSel ? (
                      <select style={styles.inputSm} disabled>
                        <option>Select shape first</option>
                      </select>
                    ) : row.shapeSel === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 90 }}
                        placeholder="Describe shape/size"
                        value={row.customShape}
                        onChange={(e) => updateRow(i, { customShape: e.target.value })}
                      />
                    ) : (
                      <select
                        style={styles.inputSm}
                        value={row.sizeCode}
                        onChange={(e) => updateRow(i, { sizeCode: e.target.value })}
                      >
                        <option value="">Select size</option>
                        {DIA_SIZE.filter((d) => d.shape === row.shapeSel).map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.code} · {d.size} ({d.wt}ct)
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: "var(--muted)" }}>{calc.size}</td>
                  <td style={styles.td}>
                    {(row.mode || "natural") === "natural" ? (
                      <select
                        style={styles.inputSm}
                        value={row.quality}
                        onChange={(e) => updateRow(i, { quality: e.target.value })}
                      >
                        {NATURAL_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        <select
                          style={{ ...styles.inputSm, width: 64 }}
                          value={row.lgdShape}
                          onChange={(e) => updateRow(i, { lgdShape: e.target.value })}
                        >
                          <option value="RND">RND</option>
                          <option value="FANCY">FANCY</option>
                          <option value="ODD">ODD</option>
                        </select>
                        <select
                          style={styles.inputSm}
                          value={row.lgdGrade}
                          onChange={(e) => updateRow(i, { lgdGrade: e.target.value })}
                        >
                          {LGD_GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </td>
                  <td style={styles.tdRight}>
                    {row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 62, textAlign: "right" }}
                        type="number"
                        step="0.001"
                        placeholder="ct/pc"
                        value={row.customWt}
                        onChange={(e) => updateRow(i, { customWt: e.target.value })}
                      />
                    ) : calc.wtPerPc ? (
                      fmt(calc.wtPerPc, 3)
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.inputSm, width: 48, textAlign: "right" }}
                      type="number"
                      min="0"
                      placeholder="qty"
                      value={row.pcs}
                      onChange={(e) => updateRow(i, { pcs: e.target.value })}
                    />
                  </td>
                  <td style={styles.tdRight}>{fmt(calc.totalWt, 3)}</td>
                  <td style={styles.tdRight}>
                    {row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 66, textAlign: "right" }}
                        type="number"
                        step="1"
                        placeholder="$/ct"
                        value={row.customRate}
                        onChange={(e) => updateRow(i, { customRate: e.target.value })}
                      />
                    ) : calc.priceEditable ? (
                      <input
                        style={{ ...styles.inputSm, width: 66, textAlign: "right", background: "#FDF6E8", borderColor: "#EAD9A8" }}
                        type="number"
                        step="1"
                        placeholder="enter $/ct"
                        value={row.manualRate}
                        onChange={(e) => updateRow(i, { manualRate: e.target.value })}
                      />
                    ) : (
                      fmtCurrency(calc.perCt)
                    )}
                  </td>
                  <td style={styles.tdRight}>{fmtCurrency(calc.total)}</td>
                  <td style={styles.tdRight}>{fmtCurrency(calc.settingTotal)}</td>
                  <td style={{ ...styles.td, fontSize: 11, color: "var(--muted)" }}>{calc.settingType}</td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      onClick={() => onRemoveRow(i)}
                      title="Remove this row"
                      style={{ background: "none", border: "none", color: "#B5651D", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={styles.td} colSpan={7}>
                Totals
              </td>
              <td style={styles.tdRight}>{fmt(totals.totalPcs, 0)}</td>
              <td style={styles.tdRight}>{fmt(totals.totalWt, 3)}</td>
              <td></td>
              <td style={styles.tdRight}>{fmtCurrency(totals.diamondTotal)}</td>
              <td style={styles.tdRight}>{fmtCurrency(totals.settingTotal)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button style={{ ...styles.smallBtn, marginTop: 10 }} onClick={onAddRow} type="button">
        + Add custom stone row
      </button>
    </div>
  );
}

function BreakupSummary({
  casting,
  labor,
  cadFee,
  cadType,
  diamondTotal,
  settingTotal,
  grossTotalUSD,
  locInfo,
  fxRate,
  totalWithDutyUSD,
  totalWithDutyLocal,
  breakupPct,
  sspCode,
}) {
  const items = [
    { label: "Casting", value: casting },
    { label: "Labor", value: labor },
    { label: `CAD · ${cadType}`, value: cadFee },
    { label: "Diamonds", value: diamondTotal },
    { label: "Setting", value: settingTotal },
  ];
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="05" title="Quote breakdown" />
      <div style={styles.breakupGrid}>
        {items.map((it) => (
          <div key={it.label} style={styles.metricCard}>
            <div style={styles.metricTab} />
            <div style={styles.metricLabel}>{it.label}</div>
            <div style={styles.metricValue}>{fmtCurrency(it.value)}</div>
            <div style={styles.metricPct}>{fmt(breakupPct(it.value), 1)}% of total</div>
          </div>
        ))}
      </div>
      <div style={styles.divider} />
      <div style={styles.totalsGrid}>
        <div style={styles.totalBlockMuted}>
          <div style={styles.metricLabelOnDark}>Gross total · USD</div>
          <div style={styles.bigValueMuted}>{fmtCurrency(grossTotalUSD)}</div>
        </div>
        <div style={styles.totalBlockMuted}>
          <div style={styles.metricLabelOnDark}>With {(locInfo.duty * 100).toFixed(0)}% duty · USD</div>
          <div style={styles.bigValueMuted}>{fmtCurrency(totalWithDutyUSD)}</div>
        </div>
        <div style={styles.totalBlock}>
          <div style={styles.metricLabelOnDark}>
            {locInfo.code} total · {locInfo.currency}
          </div>
          <div style={styles.bigValue}>{fmtCurrency(totalWithDutyLocal)}</div>
          <div style={styles.fxNote}>fx rate {fmt(fxRate, 3)} · SSP: {sspCode}</div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ eyebrow, title, noMargin }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: noMargin ? 0 : 12 }}>
      <span style={styles.eyebrow}>{eyebrow}</span>
      <span style={styles.panelTitle}>{title}</span>
    </div>
  );
}

function Field({ label, children, grow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: grow ? 1 : "0 0 auto" }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

/* ============================================================
   STYLES — "Atelier Rose" design system
   ============================================================ */

const ROSE = "#9C4A63";
const ROSE_DARK = "#6E2F42";
const ROSE_TINT = "#FBEEF2";
const ROSE_TINT_STRONG = "#F3DCE3";
const INK = "#241B1E";
const MUTED = "#8B7680";

const styles = {
  app: {
    "--muted": MUTED,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    background: "#FFFCFD",
    color: INK,
    fontSize: 14,
    minHeight: "100%",
  },
  shell: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "20px 24px 40px",
  },
  topBar: {
    background: INK,
    borderBottom: `3px solid ${ROSE}`,
  },
  topBarInner: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "14px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandBlock: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: ROSE,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 0.5,
    fontFamily: '"Playfair Display", Georgia, serif',
  },
  brandTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: '"Playfair Display", Georgia, serif',
    letterSpacing: 0.2,
  },
  brandSub: { color: "#D8B7C2", fontSize: 11.5, marginTop: 1 },
  topBarActions: { display: "flex", gap: 10 },
  uploadBtn: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 500,
    color: "#fff",
    background: "transparent",
    border: "1px solid #5A4750",
    borderRadius: 6,
    padding: "8px 14px",
    cursor: "pointer",
  },
  pdfStatusBar: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "8px 24px",
    background: "#332229",
    color: "#E9CCD5",
    fontSize: 12.5,
  },
  card: {
    background: "#FFFFFF",
    border: `1px solid ${ROSE_TINT_STRONG}`,
    borderRadius: 10,
    padding: "18px 20px",
    marginTop: 14,
  },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: 700,
    color: ROSE,
    letterSpacing: 1,
    background: ROSE_TINT,
    padding: "2px 7px",
    borderRadius: 4,
  },
  panelTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: INK,
    fontFamily: '"Playfair Display", Georgia, serif',
  },
  rateStatus: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  smallBtn: {
    fontSize: 11.5,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    background: ROSE_TINT,
    color: ROSE_DARK,
    cursor: "pointer",
    fontWeight: 500,
  },
  warnBanner: {
    background: "#FDF6E8",
    border: "1px solid #EAD9A8",
    color: "#7A5B12",
    fontSize: 12,
    padding: "8px 10px",
    borderRadius: 6,
    margin: "10px 0",
  },
  tableSourceRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  importMetaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 },
  importChip: {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 12,
    background: "#F7EEDD",
    color: "#7A5B12",
    fontWeight: 600,
  },
  flagPill: {
    fontSize: 10.5,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#FCE8D6",
    color: "#9A4A16",
    fontWeight: 600,
  },
  okPill: {
    fontSize: 10.5,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#E3F0E8",
    color: "#2F6B45",
    fontWeight: 600,
  },
  sourcePill: {
    fontSize: 10.5,
    padding: "3px 8px",
    borderRadius: 10,
    background: "#F3EEEF",
    color: MUTED,
    fontWeight: 500,
  },
  sourcePillLive: { background: ROSE_TINT, color: ROSE_DARK },
  syncNote: { fontSize: 11, color: MUTED, marginTop: 6 },
  fieldRow: { display: "flex", gap: 14, flexWrap: "wrap" },
  label: { fontSize: 10.5, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    height: 33,
    padding: "0 9px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    fontSize: 13,
    background: "#fff",
    minWidth: 110,
    color: INK,
  },
  inputSm: {
    height: 28,
    padding: "0 6px",
    borderRadius: 5,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    fontSize: 12,
    background: "#fff",
    width: 100,
    color: INK,
  },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 0 },
  table: { fontSize: 12.5, marginTop: 10 },
  theadRow: { borderBottom: `2px solid ${ROSE_TINT_STRONG}` },
  th: { padding: "6px 8px", color: MUTED, fontWeight: 600, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 },
  thRight: {
    padding: "6px 8px",
    color: MUTED,
    fontWeight: 600,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right",
  },
  tr: { borderBottom: "1px solid #F6E9ED" },
  trActive: { background: "#FFFCFD" },
  td: { padding: "7px 8px", verticalAlign: "middle" },
  tdRight: { padding: "7px 8px", verticalAlign: "middle", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  totalRow: { borderTop: `2px solid ${ROSE_TINT_STRONG}`, fontWeight: 600, background: ROSE_TINT },
  totalGramNote: { marginTop: 10, fontSize: 12, color: MUTED, textAlign: "right" },
  posBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    fontSize: 11,
    fontWeight: 600,
    background: "#F3EEEF",
    color: MUTED,
  },
  posBadgeActive: { background: ROSE, color: "#fff" },
  toggleGroup: { display: "flex", gap: 6 },
  toggleBtn: {
    fontSize: 12.5,
    padding: "7px 16px",
    borderRadius: 6,
    border: `1px solid ${ROSE_TINT_STRONG}`,
    background: "#fff",
    cursor: "pointer",
    color: INK,
    fontWeight: 500,
  },
  toggleBtnActive: { background: ROSE, color: "#fff", borderColor: ROSE },
  breakupGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 },
  metricCard: {
    position: "relative",
    background: ROSE_TINT,
    borderRadius: 8,
    padding: "14px 14px 12px",
    overflow: "hidden",
  },
  metricTab: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: ROSE,
  },
  metricLabel: { fontSize: 11, color: ROSE_DARK, fontWeight: 600, marginBottom: 4 },
  metricValue: { fontSize: 18, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  metricPct: { fontSize: 10.5, color: MUTED, marginTop: 3 },
  divider: { height: 1, background: ROSE_TINT_STRONG, margin: "18px 0" },
  totalsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 },
  totalBlockMuted: { background: "#2E2227", borderRadius: 8, padding: "16px 18px" },
  totalBlock: { background: ROSE_DARK, borderRadius: 8, padding: "16px 18px" },
  metricLabelOnDark: { fontSize: 11, color: "#D8B7C2", fontWeight: 600, marginBottom: 6 },
  bigValueMuted: { fontSize: 21, fontWeight: 700, color: "#F1E2E6", fontVariantNumeric: "tabular-nums" },
  bigValue: { fontSize: 23, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" },
  fxNote: { fontSize: 10.5, color: "#D8B7C2", marginTop: 4 },
};
