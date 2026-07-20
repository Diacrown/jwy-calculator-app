import { useState, useMemo, useCallback, useEffect } from "react";
import { fetchLiveSheetData } from "./sheetData.js";
import { POLL_INTERVAL_MS } from "./config.js";
import { parseOrderFormJson } from "./pdfParser.js";
import { pdf } from "@react-pdf/renderer";
import JSZip from "jszip";
import { QuotePdfDocument } from "./pdfDocument.jsx";

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

// Item# first-letter -> location, for auto-selecting Location when an
// Item# is entered/imported. Only the 8 confirmed mappings -- DMG and
// DMR intentionally have no letter and are never auto-selected. This is
// only a convenience default for initial loading; the user can freely
// change Location afterward regardless of what the Item# implies.
const ITEM_LETTER_TO_LOCATION = {
  T: "DMT",
  M: "WSME",
  S: "WSSY",
  B: "WSBN",
  N: "WSNZ",
  K: "WSUK",
  I: "WSIT",
  P: "WSPL",
};

// Shape display order for the Select Size dropdown, matching the CAD
// Order Form's own shape dropdown sequence.
const SHAPE_ORDER = [
  "Round", "Baguette", "Carre", "Emerald", "Heart", "Marquise", "Oval",
  "Princess", "Pear", "Radiant", "Single Cut", "Sq. Cushion", "Sq. Emerald",
  "Tappered Bagguette", "Triangle", "Trilliant",
];

// Matches the CAD Order Form's own Stone Type dropdown exactly. Only
// "Mined" and "Lab grown" have real pricing data (DiaSSP grid / LGD
// bands) -- every other value here always prices manually (see
// rowCalcs), and "Mount" additionally never gets a setting charge.
const STONE_TYPE_OPTIONS = [
  "Mined", "Lab grown", "CZ", "Mount", "Semi-Mount", "Cabochon", "Color",
  "Opal", "Alexandrite", "Ametrine", "Amethyst", "Aquamarine", "Citrine",
  "Emerald", "Garnet", "Hessonite Garnet", "Iolite", "Morganite", "Pearl",
  "Peridot", "Ruby", "Sapphire", "Spinel", "Tanzanite", "Topaz",
  "Tourmaline", "Zircon",
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
// Sample/fallback data -- used only if the live Natural Prices sheet
// isn't reachable. Real structure confirmed: SizeGroup column maps to
// SSP pricing, same group-code keying as this table already uses.
const SAMPLE_NATURAL_PRICES = {
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
// Sample/fallback LGD pricing -- used only if the live sheet isn't
// reachable. Confirmed structure: one row per (Shape, MinCt, MaxCt),
// three real columns (D_VVS2, D_VS1, Non_cert). Bands above 1.49ct are
// UNVERIFIED placeholders from an earlier chat paste, pending
// confirmation against the live sheet.
const SAMPLE_LGD_BANDS = [
  { shape: "RND", minCt: 0.001, maxCt: 0.009, dvvs2: null, dvs1: null, nonCert: 135 },
  { shape: "RND", minCt: 0.01, maxCt: 0.49, dvvs2: null, dvs1: null, nonCert: 100 },
  { shape: "RND", minCt: 0.5, maxCt: 0.89, dvvs2: 230, dvs1: 200, nonCert: 100 },
  { shape: "FANCY", minCt: 0.5, maxCt: 0.89, dvvs2: 280, dvs1: 250, nonCert: 150 },
  { shape: "RND", minCt: 0.9, maxCt: 1.49, dvvs2: 170, dvs1: 160, nonCert: null },
  { shape: "FANCY", minCt: 0.9, maxCt: 1.49, dvvs2: 170, dvs1: 160, nonCert: null },
  { shape: "ODD", minCt: 0.01, maxCt: 3.99, dvvs2: null, dvs1: null, nonCert: 250 },
  // UNVERIFIED -- not yet confirmed against the live sheet.
  { shape: "RND & FANCY", minCt: 1.5, maxCt: 1.99, dvvs2: 200, dvs1: 170, nonCert: null },
  { shape: "RND & FANCY", minCt: 2.0, maxCt: 3.99, dvvs2: 220, dvs1: 180, nonCert: null },
  { shape: "RND & FANCY", minCt: 4.0, maxCt: 4.99, dvvs2: 280, dvs1: 250, nonCert: null },
];
const LGD_GRADES = ["Non-cert", "D/VVS2", "D/VS1"];

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

// Real currency symbols for the final local-currency total. AUD/NZD
// spelled out (matches USD/EUR/etc conventions on this multi-currency
// quote) rather than the A$/NZ$ shorthand.
const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "AUD $",
  NZD: "NZD $",
  PLN: "zł",
  INR: "₹",
};
const fmtLocal = (n, currencyCode, dp = 2) => (CURRENCY_SYMBOLS[currencyCode] || "$") + fmt(n, dp);

// Rounds a final quote figure UP to the next multiple of 5 (e.g. 682.41
// -> 685, 680.00 -> 680 unchanged since it's already a multiple of 5).
// Applied only to the customer-facing grand totals, not to intermediate
// line items -- rounding every row would compound error and make the
// line items stop summing to the displayed total.
const roundUp5 = (n) => (isFinite(n) ? Math.ceil(n / 5) * 5 : 0);

function emptyRow() {
  return { mode: "natural", stoneTypeSel: "Mined", shapeSel: "", sizeCode: "", quality: "TW SI1", lgdGrade: "Non-cert", lgdShape: "RND", pcs: "", customShape: "", customWt: "", customRate: "", manualRate: "" };
}

// "Made with Love" logo, embedded as base64 in both colorways so print
// output never depends on an external asset URL or hosting path -- works
// identically on Netlify, GitHub Pages, or offline. Black variant for
// light/print backgrounds, white variant for the app's dark top bar.
const LOGO_BLACK = "data:image/png;base64,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";
const LOGO_WHITE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVQAAAFUCAYAAAB7ksS1AAABamlDQ1BJQ0MgUHJvZmlsZQAAeJx1kL1Lw1AUxU+rUtA6iA4dHDKJQ9TSCnZxaCsURTBUBatTmn4JbXwkKVJxE1cp+B9YwVlwsIhUcHFwEEQHEd2cOim4aHjel1TaIt7H5f04nHO5XMAbUBkr9gIo6ZaRTMSktdS65HuDh55TqmayqKIsCv79u+vz0fXeT4hZTbt2ENlPXJfOLpd2ngJTf/1d1Z/Jmhr939RBjRkW4JGJlW2LCd4lHjFoKeKq4LzLx4LTLp87npVknPiWWNIKaoa4SSynO/R8B5eKZa21g9jen9VXl8Uc6lHMYRMmGIpQUYEEBeF//NOOP44tcldgUC6PAizKREkRE7LE89ChYRIycQhB6pC4c+t+D637yW1t7xWYbXDOL9raQgM4naGT1dvaeAQYGgBu6kw1VEfqofbmcsD7CTCYAobvKLNh5sIhd3t/DOh74fxjDPAdAnaV868jzu0ahZ+BK/0HFylqvLiAv9gAACaUSURBVHja7d13nF1Vuf/x75qShBogCZ0AoSMgSFcRERAVKSIWFCmCig0FAQHRa0FE0WtDkKsIQfyhiA2l6MWLiFRBUSmiCArSERFF0ma+vz/2s8zKdp8zZ2bOhJn4eb9eeZ3JKbuds5/9rLVXkQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACMP4lDgCWF7R5JPcVTgymlQY7MsI9jKo7jYMSJlFIa4OgAS34A6I0ggC4cS44CGSr+czNSp5Qc/3+2pF0kbShpvqRvpJSutd1Dpjr0sczHyPZqkvaV9FJJ60p6TNKFKaUzbad8vPHv+jgEmKABoC+ltCD+PkDSeyRtXXvb45KujeIrAbVNVppSGrA9SdLrJW0QQfTqeMtekl5o++aU0o35/Rw5YOKf/CkyU9l+nu0bbc+zfbft623/ypW7c1UA1QHtL0zxuJHtz9h+ScN7zrI9YPsN5WcATPBgWvz9Ads/s/1G2zNqAfd5tnepfwYtg+mLbH/L9nq5+G+7z/aU+Pt1tgdtv46ACiwZJ3/OSifbPsf2p+ondj14Ekw7CqZ72r7W9ir1YFm8562R9W+bqwg4gsDED6bL2j7f9oFFNtpXy1xTFPU56Vsfz9543Mn2XbZnNgXKfGxtn2n7yahj5UIFTPRifgTTr9jeLf7fz9EZ1cVpbdsP2d6uVdZZHPt7bX+W4j4wwYNp1OFNsv1F2ztzUo/6ePbZ7rd9h+0jWh3P4obejnHTb9XyhiCAiRcAch3eZ23vQTDt2vE83/b32mX6xXuvtv3BVlksgIl18n/I9iEE01Efz1xvup/tx6MKpbGHWXHsX237l7lOmrpTYGIH0zfZPrVdJoWOi/o9tley/Xfbe7bKOIs61lVt32l7o/J5AMWJNYEyqZ1sX0Z21NVjepHty1pl+7mFRPx9me1XUtTHRMsceseyKFuso2eCHI9ke4btX9vekOyoa8H0+dGWdGZkqz1tSgafsf3uVoEXGPfZYreDXu7tUntu5XEeTMsbIW/jhO5qQP2d7c+3yU7z+95r+wSOPSZcMI0gsr3tj9n+aDRn6enC8ntqgXVn25+OOslx2fSlCKan2f4RJ3RXg+mhtufbXiF+D/WOELne9J22j+HYYyL9yPOPd8Xo8pet043ibXESrWX7v6Lo/GvbmzVlxuPsxN/D9j9sT29VLMWwMv6e6I//N9vvqwfKWmB9p+23lN8HMBF+5L3xQ78qAumg7au6FExzlre17UeLYJ3v6vaPw2PSE/9WtP1UDMXHSd29i9TJEVCnlNlpcWHvt30MN6AwEX/kOeB9wfZfbM+JgDe7rEMc5Qm0RTSNmRf/Hra9/Hgdxq44Jj+yfQnFza5dpJLtVeL39dbasc6/lZVtH2/7uQRTTNRg+sH4Eb+myCDfP5pAUpwg69l+wPYBtn8ay/7WeD1Ziu0+3PaCaCdJUb97x/X8+D30FiWBnKFuFZnpOgRTTNRg+irb58ffxxUBdcQD9xZFt5WjrnTPOHGezNnJaLPfMS7qr1E7Br1L0Peeiv3sqQe1sQqmsd5N47i+Pp6fVLxnX9uH2V6q/A0BE6L4FY9b2v6O7aXjB/+JIqC+cCTBpGi3uYztK2zvW5wwjju7zxqPJ02RRf20qEPuXdK+95G+3uK77u1gufm4/tj2HyKA5+dWjwvsbuVyOUsxkTKUZHua7Yttr128dlYR9DYe7klWy34usL1/kaGcEsu+vciO0zg6LvkEP7hobL7EjWQUHRQ2ielF1rG9Qfx/7ZEcr6GCcUMj/v2K13aLYLoWWSkmajDNwexrRRY6OR6/ET/6v+QpPIYT9Iplf872QWWxzvZPYtnnjrfMr7gIrBQ3zU4caXXHOC/mP8f2D22fYfvD0bD+q7ZPtH1dVP8sNdR3XpRwpto+0PapUVeeGjqH5PfeYvs38fcs22+x/dKRZsfoHAd27PSmlBbYPkXSNSmln0TQmB+vrxiPf5X0xDBP2r5Y9kmS7kwpnWd7UkppXgTnLeKt18bjeCrWpZiu+ExJD0g6NQL+hJ9FswhwK0o6QdKVkixpE0mz43xbX9L3JL1a0nYpJbfLOFNKg9E+9B5VM5J+Jf5WOZ1z/CYGbe8j6dmSTrC9l6TdJf0gpXRZDsJMqY2JdmLl7PEg22fWnst3WW+ILPKG4WSnxXIOL7O7orj34ljugO0tx1NGUmzjzrGNLxhvGXSXMvBkex/b58bkd/dGieT3Udd9nu1jc9vQIY7V7nGsbm4I3PXfRIpM+MnISrcnK8VEP6HyibB1jNgzuT6dcfz/jjhRLuk0qBTLfrntj9dOprJZlm3fY3vKcKsSxrgonJvv3GP720taMK0HvKg7/VDMNjDb9um2P59nZO2wWuT+aFc8qyF49hafmRz98B1VA71lgOfMxIQ8kYpePz+xvUGtbqucH+nPtXrOvg6D6TbRMaCvRc+XH8Zyv9+tgNU00MooLjS5udiqS3Kb01oX4NNsXx5zYu0y1PdSG1nfRZfQvvoxi7rV/Wy/L9ry/rAMypyVWBKK+t/Jd1hrWUQOfqva/mucLJ8cKqAWwXKm7bNtr1BbXipOrodiuR/uJFB3Eky7FJB7oufOYNT9LvE9ooqgukpcSIachrn4zD7xPV4Zx66/9r5Ztg+x/f7iDr6jp1zZVIrsFBM6mH6sVZAsAuMGtufGCfDedsGlaHqVZ/1cvx7oaoMyZ3uPJEMtT8biuW2i6DpzOF1Yc2ZbHJtvRFfY/k6Kog0jI/WM0XfX02rWz1r99L/+32b6kFSUVHo7afJUfCYvd8Uo6j+di/rxvulRR35UDGayY3Exfdz2N4sqpXKwaDJVTMhM5JW2ryyKZ62atWxdBL7Dhgioedmn296pKUgWASsXp+fYXm84J1NDnVxvjAGQOwl8YxiBtCk45baRr+4gS0uLKZCmkbw20vfWq37avO/LufQSF7F9IoAeZXtv26vV3p/rzdeOY9ff7rvA2GEQii5kNymlgagvPUXSrnHCDJbNWkI+kaYWzz3eLuuN5lEflnRjSunq/Fz9rfH43Hi8X9Kfa6+1DYAppQFJA7a3kbSTqiY+82Kf/irpBknH2r4kpXRb7PdgQ2BJcTz6Y3teIGlzSXtIuj6ldGE+Zm2O52D8vUt8dt+o5jgppXRpsb2jCqb5+4neZJtL+n5K6am8fNvTJL1K0mMppYuiUfxrVDVL+6KkW1JK/yyWM1nS8pJWkrSKpDUl/T3+rZZSuqC23h5JkyUtFb+JFSRtK+kwSf+Q9JSkl0q6W9JFKaUHaxdRx+eOl3RWSulPtvtTSvNjW4+TtIft41NK3+7GcQMBdSyDaZKUM4JvSToupfTnNj/cHFBXKJ57oinwFcH0zaqi1HlNwTRO0IHol71VPP37lNLcpqDXKpjaXlPSaZL+KekcSddLOkTSspLemFI6x/bSivaiDcE077NjCL7NJN0r6eoIyK+SdGztODQGU9srqWrHea2kcyPofCKC2aUaZbvaYj1rSfq6pFmS3ixpbnHcN5X0yQhod0m6KLbjZZJ2kfQGSX+3fY+khyX9JS6Of5H0qKRHJN0h6W2SDpd0dKx+ku13RCCcI2mBpLlx3B+TdHK878iU0jkNv7ceSYOSHN/bB+M8/mB8L/Nj+pL3R2CXpD0lfVvjqz0y0LLe9Ou2T29XdK+9//CiyL91mzrR3W2f067oVhQjt4q2p7b93x1sSzlS++viZtZRxetTbT9h+9ZWdYwN27uq7Utsf8T2ssXrNxVVIUPtxzrx/t2L146qVReMZpjDXFfZb/vGWO6Otf2YafvI6Dr6O9sXF59fP+6m/9X2a20/1/bG8d76jaM9Yvk/LuuEoypl6YY69p1j2VeXdbtNdcmxnDXjO/9cPL+C7c/Gtt8QPdEGbb+E4j8mSjB9h+3bihsWqYPPHBsn2tz6RHTF44bR/39quxtBxTKPKIL0m4eoly2D6WnxmZcWxVbZ/lQ8v/sQgTCv/zm2H8tBubgxclAs59n1etqGYLp6DIz99vh/7kp7n+2b603FRvm9fTq26515XbHsSbaPzheEaN52UHHcVo8gdXuri0sE6+lxkZpbzJbQ6sZXf+zbzbFN2w5xzHPgPy+2ZZrt1aI5Xa5n/2Us63exT4k7/hivwbS3CCJP19ubdnAynxo/9idtr1HLOnpsLxeZ3iZDLbd2cmW7DHEC53V9Nd7/4nhtSjyfs7ArOzyxd4hM6ZQclIubWo+3axNbZIyTbP/G9uW1178WWfLK9QFUhhskalOt2Pa1RRDMr73Z9h7x9/bRAWNyEfSnxb7eVN7tLzttxOPnYx2nd3hBekm8/+tDHfNY30bx/k/Fcf5M0QJk4/hd2vaxo83qgTGtN40f9TKRTb210x9scfLku7iPxo2P+mAqX7f9imEstyey5Jz1zmoKxLV1zI73H1FkaPm1S+K17doEwhw4NouTN8/33p+LvsU6tmiTnebl5NG3tosxUnez/SXb/11kzalWnzjc760nMv57Iyjm/euL19eJAJ636Wzbr6t9d9NjOy+qH5vic1vFKGKPRzVIatFcKr9/zcgk50QwTB1cxL4bU8ZsEVUs6xS/hXfENj4WVRFkpxj3Rf1LbV8xnKt/cTJ8J37wfy6KljkIfSJuNHTSe6qsd8zTqTxge5mmoFNs+8m5KVQRUMpBsG37e22Cac5wp9v+k+1Hou1kT1FMPyCWc3EHQTn37f9FjCJ/mO1X5KHmGoJp3u+NiqDY6Tihp8e6zm/ITs8qLpA7FnWTvcU6145i9nH176hYzhVDda4olrds9KKy7Qs6LBFsE++/MNoHb1z7Df20004jwHgIpkdHhf+Kw+niV5xE+Qd/d667i+cPLQJZ3zAC9D5Fcf9XQ7z35fG+h4vsKe/XGvH8gmgrmxravJbvv7zWiSAH02fFQCCOzgapTWDuKQaK2aFVEbfhGK4SnSjWHCoDq42vsMD2P6OOur7vf44i/fJxc2el4uKRl/G8XCdc2578+l5F6WNGU3ZaG5LvaNt35f0fIjvNn/tRZNh3RDO38thvWezjukviOLNYsupNty4H7x3hKPu3xjJ+W2QV20cd4gqd3nhpyDhdZM09DcXdFYsxBN5Zy2omF1URl7bK+or3H1XLQCcVgenjtu8sxuRsV9zdNZbz+6IHVWNPpOIz0yIzW6uT4n8RiPIF4LwiWOdjeIrta+JYfbRef11UCxxp+8GmzgexvHxj6bSmC2OxDytFY/1Do5rm5nb7Unxul+K7PqbYtnoG/qWR/D6BxVlvulR0Cfz2cItSxU2LZYqgdkeciNMiW91hOCdBcbJfWpxkF7ap2/t4EbymFEGiP/qF52Cwa9N2FMFnk8iA5sUFpqe4mfahmIBw0PYb2xR58zadG++d3WFxd83oGbTuMIv6z4/1DEaWmYr9742WBLNtv71oytbbou7ytNrxyI/7FvXYmzbcROstLjonRQZ7YXzm3e1+U8V3nasTbiyrI2JdM6Ledm50byY7xbgu6p8XdZXThjuaTxFQVysm0Lslnru+qU6uw+VNiuHwsnNqwaKvWO8T8Z6jiv7j/VFneUDc5Lh9iOxws7iB8q/2lTlzjaZI60XrgadtL9eiLjcVn8nLOrlpMsFaUNvR9gdsr9pJMK1t99diPbcVd8r7i7rYgRhucWbDevOxWio+P6sW5PLj/0bAvqa2n+WoYFvHPqwS1Q6OIvrmTSWL2j5sW7Q1PqSh/vuYeO0MslOM96L+frW+98MedKSoXxyMZf0xblBdNoKMNy9v3cgUB2onUz2IHVU01ZpZ1OF9KALKB+L1E2sXkTIYvCCaA+UG428qsu4zor506VjO11odp9roWU/F+z8S65pSFsWL6ojDbL+7uOHWM4yLztJxrB1tNXtrA558pBakJrX4DbzG9pdrz+V9Wau4UH4iAt2UWrXAQbbfU9yI/HTDzcnUMERfve3svKJKorcI9vfF8VyD7PSZwd2/oYOWbU+X9GVJN6WUzh5hn+h8Yq0cf8+RNFNVF8R1Yl0DI1je+pJ6VU2t0itp62iKNd/26pKmpZSukbRrLP/alNK90Xj8QEnnpJTutP3aWN5VsS2p6JbaY/twVV0j88jxlnRz3GE+RVVf8qtzI3hJF+SuuQ3bnrtPvktVd84BSTtFd9Y5tUDyMlVjC1yVUjo7B50Op/FIsZ0rSpqhqpvng7FPU2w/T9KGqrqXStLMCJSDLY713pI+EPtVHyNhBUnLxb70RBfhBbG9O0naK34/nyr2bdf47D8V3V5VjQGRxzLYRFW319zdeOv4u7/YpvwdHahq7ICTU0r302+fgDoe5X7yn42T8l2jWVYRUCVpSjy+PaX0txaDnnS6vDzIhiRtp6oP/I8k3VYEwPUi4G5o+2OSJkn6eErpgQjAq0cwuDNO6HxSbxHB4OaU0uUx3GDuYnmZpF9Kel9K6eYIxM+Nz14X8yUN1KtPoq/8OyT9WNIO8ZmdoxnXt2P560laVdLtkj6WUno898FvGHSmzTXRKS4Ed6ka1OSEuEA+LekWVX35945gtU1835OKi0FfzNV1iKSfpJT+UAarGBOgR9KdqsYZeJmk99ieqmqQmuUkPSTp8yml+4rPTpE0PY75NEmTUkpPxUbvIGk/SfdJ+kOxP6vFOftosW8DkVGfGM+fFtvDvFEYl0X93EbystHUSxXFto/mmzBRhJ08kobXRb3eDNs/iLvqX41++bMamuq8I2bD/I7tV5b7GXWZd+abI1EP+iLbJ0QRdfWi+L+27f+Let8TY1CW8i7/Fbb/WK92qDU9OrjoULBpzLt0Z7Rn/VXUAx+QB9LutIg/RLF/Zuzb22OMhKWL93wvqkyezjekasvYw/bJbaowyjrhV8ZUJMfb3jN33Kj9pnKx/q6i7vuX0ZFhdrQ42Lzh+/5iVH1Mq/2m3hTLeNNwq46AxRVQ84811y2+qF0bwWHUeR5qe+cxqp74t4tCm0ngUq1P/wuj2dBdcSf7xNzWcqiAVhsh/sdFc6m++iDLMebAe+onfpsBm3vHqpdPcRE4uJjY8J4IhKtFL6QPR4CbNNJxBNq0pd072iRfFxeVd9cGlO4Z4oKa65wfLG4mMocUxnWGum+MLDSpnnWNdvndyCRqQbE3DyDSJqD3DjW4c0OwTA2BeJHBYGqdHpy7ixafWz1ugL2ltj09DXfU+7odSMvZA2o3fHL70XO8qMHImt/W6ti0+C56i/X0diMAN+xD2XojT8y382hKUOhSHSGHoPUJGPVjm0v6XEppl3Jw4NFmkt2eG72TbcsnadP78g24qPfM42660+0s6hz7JV0cf5+p6ubNelFPeHFK6fo2g1NrtMd3NMctbh5tFdt8d9SZPjVW2xbBz/GvJ47ZQAffY74gTFNVz/r9lNKruBFFQJ0IgXVpSe9WdQNnoAg2I1pctwPpEAEun6Qu110Ev7wfVswwMIzA3NNuH2MMznVVjTx/R0rpphxEOj3pc2uDDnc5b/9IM7TUdFMwSiYD7db5TFRHxY298yXtL2ltVTektLh+X8Boi+dpAm3riG+c0XZxwlRFvajWdpaiPhnqhPxBT5X0LFXNUpKqpkitjqPjfYOR0d0f8/6kMSg+LlKVYHuGpO0lbaOqreVqquY76lE15cbjquaduk3VdCe/SCnNL07Of8u+8nbbXiWK8YOqmvG0amuas+P58dzjKaXfdrr/MdfT1Dbrsap2mT2Sbo315CJ73oaeNt/NSM+PXES/K5qdpcWRqRYlgymqppe5MqW0/wia3AHjJjPYwyN3Vs4Ex2Lb4u+do5vlI8Pctt9G989160G6zGDj8egR7v9PO8mmihtWtw1j2btGt9jF6YRW3+dYlGiKrrLfjDEllplIpaf/BLRX61yum7pF0sGqbghsq6oB9qQiY61naZdK+pmqidx+Gc8PdDOYRt3uRpJOlbRv7S0PxPpvkfRgZHErR5b9PEkbx/s2kvQ+SUfGOKAnp5Tm1Oo88+MPVDWM307SAVrY26mnyPzy4zxJX5X0C0m/rR1LDZE9HqWqHnYzSQepmjAwv96rajbRcyX9WtJvVPWyOigy8Y3iWKwV25aGUTJr9/qCImPub7mA7pdA8mymb1NVb7pp3DDreSbqcYGxylx3iwFTBorRjAZiwIsDxnjdOWN8ve2/Ff28HfMZHRm9glp9fnI0C/t5fGZOkX39PIK0hmhmtX2MoTpYjCeQB/xw0RV1tPv6pmL/BmJUpa2H+Mz06ChQfieOdp+bRka7acO/Z9nePAYjeXFMizK7OMZz4/HUNhnq1PqYAF34nl9Qm/+LelNM+ACainaGuQh2WRFE8kn7v/lkaGr/2MWT7F1FEMsB8ao8AEo+8Wrb0VerJuiz/cn47PwiKD/cYii7fAxy29zdGwJqtl4xZ9RwB5TpjaDfV4wDmrftDcVFoa/WNrbP9pR4/cBiv/J388MRHvNZxWDYji7JrUbtP8b2lk1VJyP8njeK7/egsag2AsZDcM2zcJ5anLTz4+//yg2xx2C9+aQ9tAjk84tgmoNJ/xAj2dcb57+vYXmPtJqjqlavd2FxDMoMda9R9jDLwfKdRYP7G4YKKsUYoVsVn8vb9OOikXxPm3+9xcUo7+cakR3b9v80BNQcAI+KrDqN9DdQrHP9GJHqYIIpluiAGo/HNwTUt47Fj7+4YbNlZGs5Kx6I+aRmDLc4WBsbdHZDUL0pgnPjOKnx+S3iM4O1wDqqkeMbBla27X06CahFMFpQ26YrRpI5Fscoj4p/bpsMdc9iFP6+4c7OWlzkdrB9o+09Cab4TwmoxzQE1MPGKqDGCXpTQzXDa0a6ziIrWz6yoVyEn1cbJ7Xd+KY/KrZpsJh5c8UcuEcYTDcuxmC9rZMAVXx2VvGdjDag5mz5pbGs/9dQHZLXu0EuqTSUaJq68tbHPOix/RbbF9jekGA6MdCIe4IF8Ghn+notHBtTqu543yzpwrgrP+w2ibHcnpTSk5I+qoVtSPtU3dV+b4yUP9gQiPL/Ty8XqYVD0+1fbOdIfp8Ha+EYoGfE/j0TN2Ry29xb47is3fw1OalqXXGfpA/aPi3u0i+oDz+YUnL8G4jWGkvbfrmkT1YvpwNSSr8b6fcKkKG2L5r3xchC9TvXh452fUW2tGyMYJTrHvM+vb/VOuJzk4opTcpt+/lwR5CvTTvyp9iOjrPdbmeotZkLem0fXlQ9pBbr3ixG7sqtLk6KOt2pRf3sCjFH174xwtdp0apg5fryAAJqlwJqwyyhA0Wx+smi7jR1aZ/OKPYpr+v3efDlhiCSP3dsLXgNlFNED2MCwry8/Yq6047nShqLIv9wL07F35vFxIJXxbin19n+oe2LYgzbz8VNt+2a6mMBAmr3A2pe11lF1lhvotXThfXkm0wvq92tH2wXGIvsbZUI8IO17PYrwwyo5Yyu+Q79loszoBbL2ND2lbZfXxyjvk56fLVoGbGC7ZXzlOGtvgPOsImHosQEEaML9Up6gRaOFJXr4q4b5ShYTfWEN0t6SlVdpbWwl9QL8ybVts9Rz/ewpG9qYR1qDjqvtD2jGLGrbSCKEavWl/SiePqalNIt8driGqIub+eqsd8bLtzdtGCo7Yj60sHiRmJvPP9ESumReBysj2Mb9an0fiKgYowy4fw9raVqUJJ8sucT/tZunYDFch6RdE/ehOItz2l4ru4MLewemlTdPFteVTdVaegbSnl/D1LVrTVJ+p9n4DebB79eNS4O/xzhMR0sA3A5SHcRQBcw9B4BFYs3U1pf1d3uQS06numfOghywyr2R2AtA2peVw7ogw2BYyAyyJtVjR8gLezjL0mHR4AaaLPuPPHcZFWtGaxqsrvv5te6cTyjCqWvoQdZXzHXfQ6C+8ZFoCvnS3FnnyyUgIpnMKDOLIKZi2L1X7oZUIv1PdSw3Bm2Jxcj+7f6TX2hWE6ehXNzVVNCt6sHzc/vIWlWLONrMSNob5eC0LzICPNj478IuEdKenWHmTX+w9FQeGJpGuhkrqq6zm4G1OyJhiC7dPyb2+IzuY70YlVjds7UomPCHpFS+ondclPzNCyHaeFYqme3yopHeKHYwPbxWrQeurwgLKtqjvttVY1aRftPEFCXQEs3PLdgDE/4eS1+M73tirPRAeFp22dL+lAEwnxzay/ba6SU7q/PLZVvOMWYrLvH01dEw/aeLtQxltUWH+vwMwvG4EIFAirGcXXAWFXdNC13sINMMb9+jqT3SloqZ69xUXiDqrFbe2rLyv8/sPjMWbXXRiNXk9wr6UI1j3uaVI2IP13SpqrGYuVmEQioS6A5Dc/1a+FAx6nL2dSkhmD0dPxTmyx1MG5s3Wf7e6ru7i8oAvQbbX9K0oJiWpV8M2pSBFRLukvS5V28GZWrHW5PKR07ZPSt1ru/pK9ENQCZKoadgWD8eryWSUlVs6Llxmh9KzQ899cc2DucHfULxW8tZ5kbSNqt9hvMj7uqau+ZJM1OKc1T925G/etCkcdzbXOXv1fV2AbflPTlIsMGCKgTXA4m99eCaW4+Nb32fLfWN73hufs6ma45mhslSddK+nn81gaK4vMR9SAZ/z881vWUpPNqVQhdO55xF39Bm7v8A6qaV/VKukLUpYKAOsGj6MJmSflEvluL3uDJgWbtLgfUvNw1GqoSbh3GuvJ8R2cUz+Vt38P2rLgJ1RePM1U1l0qSLokqg95nsMG7I7A+oap6bFl+lSCgTtBgWmRw+fEeVcPCqZYtbdbt9dpeVgvbvfYUAfT6YSwuN6G6SFWb1rIb62RVN6ekhXX5B0haJv7+4jjoz54D+V2SjlM14eK/ni+6lNLvHgTU8SyC2qTI3nI/+TlRfLYWnWV12y4WjcteWTOKwN0bxfBrcrDsZB9U1X/+Q9LsYhvz7+6A6JE0r7gBZEm/kvTTourgGfsO4vHhlNJpKaXr4v+D+TGqB6gKAAF1nGamebSn/SXdKenltSzuu1rYjz9/f9vYnh5310ebLeVxP3fUwp5YAxHo/i+l9FDRNXU4Wd6XVLVrzf37B1U1mt8plv0cSVvGa2dHIO0dJ99JKgcvKear2jAmScwj6nM+EVAx3mJqcXNmHUmP1TLCi1V1Ne0pnl9e0osjEI42COXRpvYuMtb870u1LLaTLC83ofpDFJlzkM6B9uBY36viovG4pK93mgUvrky1NnhJrhs+QdJniqoRiv4EVIyj7LSnevBMVcPFzZH0xxzoovj/hKp2kfW2mW+Jk9xdWP+6knYpltUTxfDLosfSghEsu96EKgf+PW1PVXUzSpK+lVJ6dJhZ8GLNVlXVDS8naU9VXXB/l1/mV0xAxTj6PiKIvEHVTZv7VQ2jl0/WXKT/pKr2oD1F8fkFtnfLd81Huf6jY/25qJ8kHR+BdNhZWFEPeqWk32jRPvTTVbUC2KioGhjPeosMfoaqm22PEFCB0WcreRT940Y7Yn8xD/yytu+LZVxZZI75fXkqlEPiPfOKWUZvtz2l1UjxHe7Ls23PjalL5sY6zinXPcpj9bYWMwHY9vX1/R1lti3b63Vx1tNU7McvYtuvLjJXkKGiC0XApVu81quqcXhqcXKm3PSmSuTSgKpBO9aMt/2h/j1FBtqbUjpX1ShMeXzUQUmbSPpyMVJ8X4dBoj9mBFhB0gWqupzOj8dfSHp77MtoWhHkLPUCVXXAvUX2mwdh+eIY/C6nqKGLdXwnqRzsucW/fKHriwx+ge3jJG0V256rZBjaDxhJAC1mrJwcz321IUP98AiWfVJ8NmeGxzRlubVt+Fax7nnx92zbS5XZYe5OWfzrq80DP9P2DfH5OfF4q+3Vupg15uzuc8U25wz1YdvLjybbq3838f/di4x4kTm4RriOd8U25+/opOGURAC0P8HWtP1oMSld/veQ7ZfYXr7FRGz9tle0vXlMG3xtw/TLe7cqatcyqDOLYnMOhr+yvU8HE8ktb/uI2rTRtn1Fnsq4W82BimL4pkUwzReBT49FYLJ9YUNAvdL2MrHvy7b4NzUm0tswZpo9PqbDrk+t/RoCKv5VguQQdJ79RAP7qZK2UNVUaTNVzZvW06KjKbkoZj6g6gbSglpVyxRJUyVNK4qL82rF3a1SSre2Ggu0mJPItl8r6aOqRrkv3aKqL/otkh6M7ci9oLZRNQneusX7n5T0cUmn5gnmutn1s5iA73JVA6QsiP3fMqV020jWV+vd9WxVva3WkvQKVXfi59d+6/NUNc9q+v3naoheVTfmltGio26V31GStENK6aZuHydgSQ+o+WbQHl485kWdZtsicC7mFtnmu2Lu9+H6k+3TosmUyknkunwc+2LZLy/WfeVoMuFi/5/vxW+V0VRTgAz1Pz1DXSWyusEi22wXCAY7OP6pIUN6MqX0/eEElXJWzcg+d1LVA2mWqiY+y8S25gztXlXNmH4m6Wcppb/XlzWGx7Nf1Q24lVQNRP0zVTd9Bkbx3UyT9OI4hmWm2ZSFehjnRmqRxT4l6WIyUxBQl9Cgr6qd5IIWAWxKDqgppadbZHomQAAE1MUatBbHqkaaJeYmQVrYgH6wqddRFLHbvmeMj2WuZx7sRhBfjN/NqL8jEFAx8S8EC794RkgCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADohv8PIrIOqx2kmwgAAAAASUVORK5CYII=";

const CUSTOM_CODE = "__CUSTOM__";

// Safety guard, matching the same check in pdfDocument.jsx (duplicated
// intentionally -- separate bundles): flags if the entered "3D render
// link" is actually this app's own address, which would otherwise
// silently become a clickable path into the internal tool once printed
// (PDF readers auto-linkify plain URL text).
const OWN_APP_DOMAIN_FRAGMENT = "jwy-calculator";
function isOwnAppLink(url) {
  return typeof url === "string" && url.toLowerCase().includes(OWN_APP_DOMAIN_FRAGMENT);
}

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

function JwyCalculatorApp() {
  const [jobInfo, setJobInfo] = useState({
    designer: "Kunal",
    jobNo: "S01022",
    itemNo: "",
    itemSize: "",
    customer: "",
    cadType: "Medium",
    remarks: "",
  });
  const [location, setLocation] = useState("WSSY");
  // Which round of quoting this represents (Q1 = initial, Q2 = revised,
  // etc.) -- saved with each quote snapshot and shown on the printout so
  // it's clear at a glance which stage a given quote is at.
  const [quoteStage, setQuoteStage] = useState("Q1");
  // Customizable print date -- defaults to today, editable via a date
  // picker before printing so a quote can be backdated/forward-dated.
  const [printDate, setPrintDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Manual override on the final local-currency price (e.g. team wants
  // to quote 1800 AUD instead of a calculated 2000 AUD, as a discount or
  // markup). Empty means "use the calculated total, unchanged" -- the
  // calculated figure is NEVER overwritten, only supplemented, so it
  // stays available for audit even when a quote was manually adjusted.
  const [manualPriceOverride, setManualPriceOverride] = useState("");
  const [primaryAlloyShort, setPrimaryAlloyShort] = useState("14KT YG");
  const [primaryGramWt, setPrimaryGramWt] = useState(3.6);
  const [secondaryAlloyShort, setSecondaryAlloyShort] = useState("14KT WG-PD");
  const [secondaryGramWt, setSecondaryGramWt] = useState(0.5);
  const [rows, setRows] = useState(Array.from({ length: 5 }, emptyRow));
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
  const [cadImages, setCadImages] = useState([]);
  const [clientRefImages, setClientRefImages] = useState([]);
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
    naturalPrices: null,
    labGrownPrices: null,
  });
  const [tableSources, setTableSources] = useState({
    metalRates: "sample",
    alloys: "sample",
    currencyRates: "sample",
    locations: "sample",
    cadFeesAndLabor: "sample",
    settingTiers: "sample",
    naturalPrices: "sample",
    labGrownPrices: "sample",
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
        naturalPrices: data.naturalPrices && Object.keys(data.naturalPrices).length ? data.naturalPrices : prev.naturalPrices,
        labGrownPrices: data.labGrownPrices && data.labGrownPrices.length ? data.labGrownPrices : prev.labGrownPrices,
      }));
      setTableSources({
        metalRates: data.metalRates ? "live" : "sample",
        alloys: data.alloys ? "live" : "sample",
        currencyRates: data.currencyRates ? "live" : "sample",
        locations: data.locations ? "live" : "sample",
        cadFeesAndLabor: data.cadFeesAndLabor ? "live" : "sample",
        settingTiers: data.settingTiers ? "live" : "sample",
        naturalPrices: data.naturalPrices ? "live" : "sample",
        labGrownPrices: data.labGrownPrices ? "live" : "sample",
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
    const { jobInfo: ji, metals, metalWarnings, stones, cadImageDataUrls, clientRefImageDataUrls, derivedSummary } = resultData;
    if (cadImageDataUrls?.length) setCadImages((prev) => [...cadImageDataUrls, ...prev]);
    if (clientRefImageDataUrls?.length) setClientRefImages((prev) => [...clientRefImageDataUrls, ...prev]);

    // Apply job info. There's no true customer-name field on the card,
    // so we leave Customer untouched rather than stuffing Style code
    // into a field labeled "Customer name" -- job identifiers are
    // shown correctly labeled in the import review panel instead.
    setJobInfo((prev) => ({
      ...prev,
      designer: ji.designer || prev.designer,
      jobNo: ji.jobNo || prev.jobNo,
      itemNo: ji.itemNo || prev.itemNo,
      itemSize: ji.itemSize || prev.itemSize,
      remarks: ji.clientNotes || prev.remarks,
    }));
    if (ji.itemNo) {
      const mappedLoc = ITEM_LETTER_TO_LOCATION[ji.itemNo.trim().charAt(0).toUpperCase()];
      if (mappedLoc) setLocation(mappedLoc);
    }

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

    // Apply stones -> calculator rows. Sized to exactly the number of
    // stones on the card (no padding to a fixed count) -- "Add custom
    // stone row" covers adding more later.
    const newRows = stones.map((s) => ({
      mode: s.diamondMode || "natural",
      stoneTypeSel: STONE_TYPE_OPTIONS.includes(s.stoneType) ? s.stoneType : s.diamondMode === "lgd" ? "Lab grown" : "Mined",
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
    }));
    setRows(newRows.length ? newRows : Array.from({ length: 5 }, emptyRow));

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

  // Loads a quote previously saved via the Print button's auto-download.
  // This is a different file shape from the CAD order-data JSON above --
  // it's the literal calculator state snapshot, so restoring it is
  // direct (no re-matching shapes/sizes/stones from scratch).
  const handleSavedQuoteUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfStatus("loading");
    setPdfImport(null);
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      if (!snapshot || !snapshot.jobInfo || !snapshot.rows) {
        setPdfStatus("error");
        setPdfImport({ error: "This doesn't look like a saved-quote file (missing jobInfo/rows)" });
        return;
      }
      applySnapshot(snapshot);
      setPdfStatus("done");
    } catch (err) {
      setPdfStatus("error");
      setPdfImport({ error: (err && err.message) || String(err) });
    }
  };

  const clearAll = () => {
    setJobInfo({ designer: "", jobNo: "", itemNo: "", itemSize: "", customer: "", cadType: "Medium", remarks: "" });
    setPrimaryGramWt(0);
    setSecondaryGramWt(0);
    setRows(Array.from({ length: 5 }, emptyRow));
    setPdfImport(null);
    setPdfStatus("");
    setPdfFileName("");
    setCadImages([]);
    setClientRefImages([]);
    setTurntableLink("");
    setManualPriceOverride("");
  };

  const persistQuotes = (list) => {
    setSavedQuotes(list);
    try {
      localStorage.setItem("jwyQuotes", JSON.stringify(list));
    } catch {}
  };

  const buildSnapshot = () => ({
    id: Date.now(),
    label: `${jobInfo.jobNo || "no-job"} · ${quoteStage} · ${new Date().toLocaleString()}`,
    jobInfo,
    location,
    quoteStage,
    printDate,
    primaryAlloyShort,
    primaryGramWt,
    secondaryAlloyShort,
    secondaryGramWt,
    rows,
    manualPriceOverride,
    cadImages,
    clientRefImages,
    turntableLink,
    // Frozen audit record of what the formula actually calculated at
    // save time -- kept even if manualPriceOverride is set, so a later
    // review can always see both "what we calculated" and "what we
    // quoted," never just one or the other.
    calculatedTotalWithDutyUSD: totalWithDutyUSD,
    calculatedTotalWithDutyLocal: totalWithDutyLocal,
    quotedTotalLocal: effectiveTotalLocal,
  });

  const saveQuote = () => {
    persistQuotes([buildSnapshot(), ...savedQuotes].slice(0, 50));
  };

  const loadQuote = (id) => {
    const q = savedQuotes.find((s) => s.id === id);
    if (!q) return;
    applySnapshot(q);
  };

  const applySnapshot = (q) => {
    setJobInfo({ itemNo: "", itemSize: "", remarks: "", ...q.jobInfo });
    setLocation(q.location);
    setQuoteStage(q.quoteStage || "Q1");
    setPrintDate(q.printDate || new Date().toISOString().slice(0, 10));
    setPrimaryAlloyShort(q.primaryAlloyShort);
    setPrimaryGramWt(q.primaryGramWt);
    setSecondaryAlloyShort(q.secondaryAlloyShort);
    setSecondaryGramWt(q.secondaryGramWt);
    setRows(q.rows.map((r) => ({ ...emptyRow(), ...r })));
    setManualPriceOverride(q.manualPriceOverride || "");
    setCadImages(q.cadImages || []);
    setClientRefImages(q.clientRefImages || []);
    setTurntableLink(q.turntableLink || "");
  };

  const deleteQuote = (id) => {
    persistQuotes(savedQuotes.filter((s) => s.id !== id));
  };

  // Fetches a quote from cloud storage (via search-quotes -> pick one)
  // and restores it exactly like any other saved quote -- same
  // applySnapshot() path as "Load saved quote", just sourced from the
  // cloud database/blob instead of a local file upload.
  const loadFromCloud = async (filenameBase) => {
    const res = await fetch(`/.netlify/functions/load-quote?filenameBase=${encodeURIComponent(filenameBase)}`);
    if (!res.ok) throw new Error("Couldn't load that quote from the cloud");
    const snapshot = await res.json();
    applySnapshot(snapshot);
  };

  // Builds a filename from whichever of Job No / Item No are actually
  // filled in, space-free and timestamped -- same "only include filled
  // fields" convention the CAD form itself uses for its own exports.
  const quoteFilenameBase = () => {
    const parts = [jobInfo.jobNo, jobInfo.itemNo].filter(Boolean);
    const base = parts.length ? parts.join("_") : "quote";
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${base}_${stamp}`;
  };

  // Builds the exact current calculator state as a JSON Blob, for
  // bundling into the same zip as the PDF (see doPrint below) -- this is
  // what "Load saved quote" reads back in later.
  const buildSnapshotJsonBlob = () => {
    const snapshot = buildSnapshot();
    return new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
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
    setRows((prev) => {
      // Find the last row that's actually been filled in (has a shape
      // or custom description, and a quantity) -- the new row goes
      // right after it, not at the literal end of the array, so it
      // appears where the user is actually working.
      let lastActiveIdx = -1;
      for (let i = 0; i < prev.length; i++) {
        const r = prev[i];
        if ((r.sizeCode || r.customShape) && (parseFloat(r.pcs) || 0) > 0) lastActiveIdx = i;
      }
      const newRow = { ...emptyRow(), shapeSel: CUSTOM_CODE, sizeCode: CUSTOM_CODE };
      const insertAt = lastActiveIdx + 1;
      return [...prev.slice(0, insertAt), newRow, ...prev.slice(insertAt)];
    });
  };

  const removeRow = (idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const rowCalcs = useMemo(() => {
    return rows.map((row) => {
      const pcs = parseFloat(row.pcs) || 0;
      const isMount = row.stoneTypeSel === "Mount";
      if (row.sizeCode === CUSTOM_CODE) {
        const wtPerPc = parseFloat(row.customWt) || 0;
        const perCt = parseFloat(row.customRate) || 0;
        const totalWt = wtPerPc * pcs;
        const tier = settingRateFor(wtPerPc, settingTiersLive);
        // Mount is structural, not a priced stone -- it never gets a
        // setting charge, regardless of any weight/qty entered.
        const settingTotal = isMount ? 0 : pcs > 0 ? (tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs) : 0;
        // A real Shape can be selected with only the Size made custom
        // (e.g. "Round" with a hand-typed size) -- in that case show the
        // real shape and the typed description as the size, rather than
        // falling back to a generic "Custom"/"manual entry" pairing that
        // would lose the shape that's actually known.
        const hasRealShape = row.shapeSel && row.shapeSel !== CUSTOM_CODE;
        return {
          shape: hasRealShape ? row.shapeSel : row.customShape || "Custom",
          size: hasRealShape ? row.customShape || "custom size" : "manual entry",
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
      // Only "Mined" and "Lab grown" have real pricing data (DiaSSP grid
      // and LGD bands respectively). Every other stone type (CZ, Mount,
      // Semi-Mount, Cabochon, Color, or any specific colored gem) always
      // prices manually, even if the shape/size happens to match
      // something in the catalog -- that catalog has no price data for
      // any of these, only dimensions.
      const stoneType = row.stoneTypeSel || "Mined";
      const isOtherType = stoneType !== "Mined" && stoneType !== "Lab grown";

      let perCt = 0;
      let priceEditable = false;
      if (isOtherType) {
        perCt = parseFloat(row.manualRate) || 0;
        priceEditable = true;
      } else if (isNatural) {
        if (sizeEntry.group) {
          // Round natural: priced from the Natural Prices (DiaSSP) grid,
          // keyed by SizeGroup -- live-fetched when available.
          const grid = (liveData.naturalPrices || SAMPLE_NATURAL_PRICES)[sizeEntry.group];
          perCt = grid?.[row.quality] || 0;
        } else {
          // Fancy natural: no DiaSSP price for this shape yet. The rate
          // is a manually-entered value on this row, same mechanism as
          // a custom row, but the shape/size stay catalog-matched.
          perCt = parseFloat(row.manualRate) || 0;
          priceEditable = true;
        }
      } else {
        // LGD prices from the unified band table -- one row per
        // (shape, weight range) with three real columns (D/VVS2, D/VS1,
        // Non-cert), matching the live sheet exactly.
        const wtPerPc = sizeEntry.wt;
        const lgdBands = liveData.labGrownPrices || SAMPLE_LGD_BANDS;
        const band = lgdBands.find(
          (b) => (b.shape === row.lgdShape || b.shape === "RND & FANCY") && wtPerPc >= b.minCt && wtPerPc <= b.maxCt
        );
        if (band) {
          if (row.lgdGrade === "D/VVS2") perCt = band.dvvs2 || 0;
          else if (row.lgdGrade === "D/VS1") perCt = band.dvs1 || 0;
          else perCt = band.nonCert || 0; // "Non-cert", also the default
        }
      }

      const total = totalWt * perCt;
      const tier = settingRateFor(sizeEntry.wt, settingTiersLive);
      // Mount is structural, not a priced stone -- never a setting charge.
      const settingTotal = isMount ? 0 : tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs;

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
  }, [rows, settingTiersLive, liveData.naturalPrices, liveData.labGrownPrices]);

  const totals = useMemo(() => {
    const totalWt = rowCalcs.reduce((s, r) => s + r.totalWt, 0);
    const totalPcs = rows.reduce((s, r) => s + (parseFloat(r.pcs) || 0), 0);
    // Dollar figures round to the nearest whole number; weight/piece-count
    // fields don't (rounding carats would be meaningless).
    const diamondTotal = Math.round(rowCalcs.reduce((s, r) => s + r.total, 0));
    const settingTotal = Math.round(rowCalcs.reduce((s, r) => s + r.settingTotal, 0));
    return { totalWt, totalPcs, diamondTotal, settingTotal };
  }, [rowCalcs, rows]);

  const casting = useMemo(() => {
    const primaryCost = castingCost(parseFloat(primaryGramWt) || 0, primaryAlloy, metalRates);
    const secondaryCost = castingCost(parseFloat(secondaryGramWt) || 0, secondaryAlloy, metalRates);
    return Math.round(primaryCost + secondaryCost);
  }, [primaryAlloy, secondaryAlloy, primaryGramWt, secondaryGramWt, metalRates]);

  const labor = useMemo(() => {
    const perGm = totalGramWt * liveData.laborPerGm;
    return Math.round(Math.max(perGm, liveData.laborMinFlat));
  }, [totalGramWt, liveData.laborPerGm, liveData.laborMinFlat]);

  // CAD fees (None/Simple/Medium/Complex/Advanced: $0/$50/$75/$100/$200)
  // are already whole numbers -- Math.round here is a no-op on those
  // exact values, just a defensive guard if that table ever gets a
  // fractional number added to it later.
  const cadFee = Math.round(liveData.cadFees[jobInfo.cadType] ?? 0);
  // Every piece above is already a whole number, so this sum is too --
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
  // Calculated figures -- never overwritten by an override, always the
  // pure output of the formula chain, kept for audit regardless of what
  // was actually quoted.
  const totalWithDutyUSD = roundUp5(grossTotalUSD * (1 + locInfo.duty));
  const totalWithDutyLocal = roundUp5(totalWithDutyUSD * fxRate);

  // Effective/quoted figures -- what the customer actually sees. Falls
  // back to the calculated total when no override is set or the entered
  // value isn't a valid positive number.
  const overrideNum = parseFloat(manualPriceOverride);
  const hasOverride = manualPriceOverride !== "" && isFinite(overrideNum) && overrideNum > 0;
  const effectiveTotalLocal = hasOverride ? overrideNum : totalWithDutyLocal;
  const breakupPct = (val) => (grossTotalUSD > 0 ? (val / grossTotalUSD) * 100 : 0);

  const [pdfGenerating, setPdfGenerating] = useState(null); // null | "full" | "priceOnly"

  // Shared by both Print and Preview -- builds the actual PDF blob.
  const generatePdfBlob = async (variant) => {
    const rowsWithCalcs = rows
      .map((r, i) => ({ r, c: rowCalcs[i] }))
      .filter(({ r, c }) => (r.sizeCode || r.customShape) && c.totalWt > 0);

    return pdf(
      <QuotePdfDocument
        variant={variant}
        jobInfo={jobInfo}
        locInfo={locInfo}
        primaryAlloy={primaryAlloy}
        primaryGramWt={primaryGramWt}
        secondaryAlloy={secondaryAlloy}
        secondaryGramWt={secondaryGramWt}
        rowsWithCalcs={rowsWithCalcs}
        totals={totals}
        casting={casting}
        labor={labor}
        cadFee={cadFee}
        totalWithDutyUSD={totalWithDutyUSD}
        totalWithDutyLocal={totalWithDutyLocal}
        fxRate={fxRate}
        cadImages={cadImages}
        turntableLink={turntableLink}
        quoteStage={quoteStage}
        hasOverride={hasOverride}
        effectiveTotalLocal={effectiveTotalLocal}
        logoBlack={LOGO_BLACK}
        printDate={printDate}
      />
    ).toBlob();
  };

  // Opens the PDF in a new tab, no download, no JSON, no zip -- a pure
  // look-before-you-commit preview.
  const doPreview = async (variant) => {
    setPdfGenerating(variant + "-preview");
    try {
      const pdfBlob = await generatePdfBlob(variant);
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank");
      // Deliberately not revoking the URL immediately -- the new tab
      // needs it to stay valid while it's open.
    } catch (err) {
      alert("Couldn't generate the PDF: " + ((err && err.message) || String(err)));
    } finally {
      setPdfGenerating(null);
    }
  };

  const doPrint = async (variant) => {
    setPdfGenerating(variant);
    try {
      const filenameBase = quoteFilenameBase();
      const pdfBlob = await generatePdfBlob(variant);
      const jsonBlob = buildSnapshotJsonBlob();

      const zip = new JSZip();
      zip.file(`${filenameBase}.pdf`, pdfBlob);
      zip.file(`${filenameBase}.json`, jsonBlob);
      const zipBlob = await zip.generateAsync({ type: "blob" });

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameBase}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Cloud archive, best-effort -- the local .zip above has already
      // succeeded regardless of what happens here. If this fails (no
      // database set up yet, network hiccup, whatever), the person
      // still has their quote; they just won't be able to find it via
      // search later. Never throws into the outer catch.
      try {
        const pdfBase64 = await blobToBase64(pdfBlob);
        const jsonText = await jsonBlob.text();
        await fetch("/.netlify/functions/save-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filenameBase,
            jobNo: jobInfo.jobNo,
            itemNo: jobInfo.itemNo,
            quoteStage,
            pdfBase64,
            jsonText,
          }),
        });
      } catch (cloudErr) {
        console.warn("Cloud archive skipped:", cloudErr);
      }
    } catch (err) {
      alert("Couldn't generate the PDF: " + ((err && err.message) || String(err)));
    } finally {
      setPdfGenerating(null);
    }
  };

  return (
    <div style={styles.app}>
      <GlobalStyles />
      <TopBar
        jobInfo={jobInfo}
        pdfFileName={pdfFileName}
        pdfStatus={pdfStatus}
        pdfImport={pdfImport}
        onJsonUpload={handleJsonUpload}
        onSavedQuoteUpload={handleSavedQuoteUpload}
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

        <ImagesCard
          cadImages={cadImages}
          setCadImages={setCadImages}
          clientRefImages={clientRefImages}
          setClientRefImages={setClientRefImages}
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
          onPreview={doPreview}
          quoteStage={quoteStage}
          setQuoteStage={setQuoteStage}
          pdfGenerating={pdfGenerating}
          printDate={printDate}
          setPrintDate={setPrintDate}
          loadFromCloud={loadFromCloud}
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
          manualPriceOverride={manualPriceOverride}
          setManualPriceOverride={setManualPriceOverride}
          hasOverride={hasOverride}
          effectiveTotalLocal={effectiveTotalLocal}
        />

        <RemarksCard jobInfo={jobInfo} setJobInfo={setJobInfo} />
      </div>
    </div>
  );
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */


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
    `}</style>
  );
}

function TopBar({ jobInfo, pdfFileName, pdfStatus, pdfImport, onJsonUpload, onSavedQuoteUpload, onClear }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.topBarInner}>
        <div style={styles.brandBlock}>
          <img src={LOGO_WHITE} alt="Made with Love" style={{ height: 34, width: "auto" }} />
          <div>
            <div style={styles.brandTitle}>JWY Calculator</div>
            <div style={styles.brandSub}>Job {jobInfo.jobNo || "—"}</div>
          </div>
        </div>
        <div style={styles.topBarActions}>
          <button style={styles.uploadBtn} onClick={onClear} type="button">
            Clear form
          </button>
          <label style={styles.uploadBtn}>
            <i className="ti ti-file-upload" aria-hidden="true" style={{ fontSize: 15, marginRight: 6 }} />
            Load saved quote
            <span title="Push Jwy Calc Json File" style={styles.infoIcon}>
              ⓘ
            </span>
            <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onSavedQuoteUpload} />
          </label>
          <label style={styles.uploadBtn}>
            <i className="ti ti-file-upload" aria-hidden="true" style={{ fontSize: 15, marginRight: 6 }} />
            Load order data
            <span title="Push Cad order form Json File" style={styles.infoIcon}>
              ⓘ
            </span>
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
        <Field label="Item #">
          <input
            style={styles.input}
            placeholder="e.g. B00630"
            value={jobInfo.itemNo}
            onChange={(e) => {
              const val = e.target.value;
              setJobInfo({ ...jobInfo, itemNo: val });
              const mappedLoc = ITEM_LETTER_TO_LOCATION[val.trim().charAt(0).toUpperCase()];
              if (mappedLoc) setLocation(mappedLoc);
            }}
          />
        </Field>
        <Field label="Item size">
          <input
            style={styles.input}
            placeholder="e.g. UK O"
            value={jobInfo.itemSize}
            onChange={(e) => setJobInfo({ ...jobInfo, itemSize: e.target.value })}
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
          {isOwnAppLink(turntableLink) && (
            <div style={{ fontSize: 10.5, color: "#B5651D", marginTop: 3 }}>
              ⚠ This looks like the calculator's own address, not a 3D render link. It won't be printed on the PDF.
            </div>
          )}
        </Field>
      </div>
    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Same mechanism as fileToDataUrl but strips the "data:...;base64,"
// prefix, since the save-quote function wants raw base64 to decode.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,14,17,0.85)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out",
      }}
    >
      <img src={src} alt="Preview" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }} />
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          background: "rgba(255,255,255,0.15)",
          color: "#fff",
          border: "none",
          borderRadius: "50%",
          width: 34,
          height: 34,
          fontSize: 18,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

function ImageGroup({ label, images, setImages }) {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const onAddFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setImages((prev) => [...prev, dataUrl]);
    e.target.value = "";
  };
  const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={styles.label}>
        {label} {images.length > 0 ? `(${images.length})` : ""}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {images.map((img, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img
              src={img}
              alt={`${label} ${i + 1}`}
              onClick={() => setLightboxSrc(img)}
              title="Click to preview"
              style={{
                width: 30,
                height: 30,
                objectFit: "cover",
                borderRadius: 5,
                border: `1px solid ${ROSE_TINT_STRONG}`,
                cursor: "zoom-in",
              }}
            />
            <button
              type="button"
              onClick={() => removeImage(i)}
              title="Remove"
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                background: "#B5651D",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                width: 15,
                height: 15,
                fontSize: 10,
                lineHeight: "15px",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
        <label style={{ ...styles.smallBtn, cursor: "pointer" }}>
          + Add
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={onAddFile} />
        </label>
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

function ImagesCard({ cadImages, setCadImages, clientRefImages, setClientRefImages }) {
  return (
    <div style={styles.card}>
      <div style={styles.rowBetween}>
        <span style={styles.panelTitle}>Images</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Auto-filled by JSON import -- click a thumbnail to preview full-size
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
        <ImageGroup label="CAD renders" images={cadImages} setImages={setCadImages} />
        <ImageGroup label="Client reference" images={clientRefImages} setImages={setClientRefImages} />
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

function CloudQuoteSearch({ loadFromCloud }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const res = await fetch(`/.netlify/functions/search-quotes?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.results || []);
      } catch (err) {
        setError("Search unavailable -- cloud storage may not be set up yet.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350); // debounce
    return () => clearTimeout(t);
  }, [query]);

  const pick = async (r) => {
    setLoadingId(r.id);
    setError("");
    try {
      await loadFromCloud(r.filename_base);
      setQuery("");
      setResults([]);
    } catch (err) {
      setError((err && err.message) || "Couldn't load that quote.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ ...styles.inputSm, width: 180 }}
        placeholder="Search Job#/Item# history…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(results.length > 0 || searching || error) && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            width: 280,
            maxHeight: 220,
            overflowY: "auto",
            background: "#fff",
            border: `1px solid ${ROSE_TINT_STRONG}`,
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            zIndex: 50,
          }}
        >
          {searching && <div style={{ padding: 8, fontSize: 11.5, color: "var(--muted)" }}>Searching…</div>}
          {error && <div style={{ padding: 8, fontSize: 11.5, color: "#B5651D" }}>{error}</div>}
          {!searching &&
            results.map((r) => (
              <div
                key={r.id}
                onClick={() => pick(r)}
                style={{
                  padding: "7px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  borderBottom: `1px solid ${ROSE_TINT_STRONG}`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FBF5F7")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <b>{r.job_no || "—"}</b>
                {r.item_no ? ` · ${r.item_no}` : ""}
                {r.quote_stage ? ` · ${r.quote_stage}` : ""}
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                  {new Date(r.created_at).toLocaleString()}
                  {loadingId === r.id ? " · loading…" : ""}
                </div>
              </div>
            ))}
          {!searching && !error && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ padding: 8, fontSize: 11.5, color: "var(--muted)" }}>No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}

function QuotesToolbar({ savedQuotes, onSave, onLoad, onDelete, onPrint, onPreview, quoteStage, setQuoteStage, pdfGenerating, printDate, setPrintDate, loadFromCloud }) {
  const [selected, setSelected] = useState("");

  const PrintButton = ({ variant, label }) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        borderRadius: 6,
        overflow: "hidden",
        opacity: pdfGenerating ? 0.6 : 1,
      }}
    >
      <button
        style={{ ...styles.toggleBtn, ...styles.toggleBtnActive, borderRadius: 0, borderRight: "1px solid rgba(255,255,255,0.35)" }}
        onClick={() => onPrint(variant)}
        type="button"
        disabled={!!pdfGenerating}
      >
        {pdfGenerating === variant ? "Generating…" : label}
      </button>
      <button
        title="Preview without downloading"
        style={{ ...styles.toggleBtn, ...styles.toggleBtnActive, borderRadius: 0, padding: "7px 10px" }}
        onClick={() => onPreview(variant)}
        type="button"
        disabled={!!pdfGenerating}
      >
        {pdfGenerating === variant + "-preview" ? "…" : "👁"}
      </button>
    </div>
  );

  return (
    <div style={{ ...styles.card, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <SectionLabel eyebrow="04" title="Quotes" noMargin />
      <input
        style={{ ...styles.inputSm, width: 48 }}
        value={quoteStage}
        onChange={(e) => setQuoteStage(e.target.value)}
        placeholder="Q1"
        title="Which round of quoting this is -- type anything (Q1, Q2, Revised, ...)"
      />
      <input
        type="date"
        style={{ ...styles.inputSm, width: 122 }}
        value={printDate}
        onChange={(e) => setPrintDate(e.target.value)}
        title="Date shown on the printed quote -- defaults to today, editable"
      />
      <button style={styles.smallBtn} onClick={onSave} type="button">
        Save
      </button>
      <select
        style={{ ...styles.inputSm, minWidth: 160 }}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Saved quotes (this device)…</option>
        {savedQuotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button style={styles.smallBtn} type="button" disabled={!selected} onClick={() => selected && onLoad(Number(selected))}>
        Load
      </button>
      <button
        style={styles.smallBtn}
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
      <CloudQuoteSearch loadFromCloud={loadFromCloud} />
      <PrintButton variant="full" label="Print (full prices)" />
      <PrintButton variant="priceOnly" label="Print (price only)" />
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>👁 previews · main button downloads PDF+JSON zip.</span>
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
                      style={{ ...styles.inputSm, width: 108 }}
                      value={row.stoneTypeSel || "Mined"}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newMode = val === "Lab grown" ? "lgd" : "natural";
                        updateRow(i, { stoneTypeSel: val, mode: newMode });
                      }}
                    >
                      {STONE_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
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
                    ) : row.sizeCode === CUSTOM_CODE ? (
                      <input
                        style={{ ...styles.inputSm, width: 90 }}
                        placeholder="Describe size"
                        value={row.customShape}
                        onChange={(e) => updateRow(i, { customShape: e.target.value })}
                      />
                    ) : (
                      <select
                        style={styles.inputSm}
                        value={row.sizeCode}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === CUSTOM_CODE) {
                            updateRow(i, { sizeCode: CUSTOM_CODE, customShape: "", customWt: "", customRate: "" });
                          } else {
                            updateRow(i, { sizeCode: val });
                          }
                        }}
                      >
                        <option value="">Select size</option>
                        {DIA_SIZE.filter((d) => d.shape === row.shapeSel).map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.code} · {d.size} ({d.wt}ct)
                          </option>
                        ))}
                        <option value={CUSTOM_CODE}>Custom entry…</option>
                      </select>
                    )}
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: "var(--muted)" }}>{calc.size}</td>
                  <td style={styles.td}>
                    {row.stoneTypeSel && row.stoneTypeSel !== "Mined" && row.stoneTypeSel !== "Lab grown" ? (
                      <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>manual $/ct</span>
                    ) : (row.mode || "natural") === "natural" ? (
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
  manualPriceOverride,
  setManualPriceOverride,
  hasOverride,
  effectiveTotalLocal,
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
          Override final price ({locInfo.currency})
        </span>
        <input
          type="number"
          step="1"
          placeholder={`calculated: ${fmt(totalWithDutyLocal, 0)}`}
          value={manualPriceOverride}
          onChange={(e) => setManualPriceOverride(e.target.value)}
          style={{ ...styles.inputSm, width: 140 }}
        />
        {hasOverride && (
          <button
            type="button"
            onClick={() => setManualPriceOverride("")}
            style={{ ...styles.smallBtn, background: "none" }}
          >
            Clear override
          </button>
        )}
      </div>

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
            {hasOverride && (
              <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.85 }}>
                (calculated: {fmtLocal(totalWithDutyLocal, locInfo.currency)})
              </span>
            )}
          </div>
          <div style={styles.bigValue}>{fmtLocal(effectiveTotalLocal, locInfo.currency)}</div>
          <div style={styles.fxNote}>fx rate {fmt(fxRate, 3)}</div>
        </div>
      </div>
    </div>
  );
}

function RemarksCard({ jobInfo, setJobInfo }) {
  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="06" title="Remarks" />
      <textarea
        style={{ ...styles.input, width: "100%", minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
        placeholder="Internal notes, client instructions, or anything worth flagging on this job..."
        value={jobInfo.remarks}
        onChange={(e) => setJobInfo({ ...jobInfo, remarks: e.target.value })}
      />
    </div>
  );
}

function SectionLabel({ eyebrow, title, noMargin }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: noMargin ? 0 : 8 }}>
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
    padding: "14px 20px 28px",
  },
  topBar: {
    background: INK,
    borderBottom: `3px solid ${ROSE}`,
  },
  topBarInner: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "10px 20px",
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
  infoIcon: {
    marginLeft: 6,
    fontSize: 12,
    color: "#D8B7C2",
    cursor: "help",
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
    padding: "12px 16px",
    marginTop: 10,
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
  fieldRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  label: { fontSize: 10.5, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    height: 30,
    padding: "0 8px",
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
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 0 },
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
  breakupGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 },
  metricCard: {
    position: "relative",
    background: ROSE_TINT,
    borderRadius: 7,
    padding: "10px 10px 9px",
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
  metricLabel: { fontSize: 10.5, color: ROSE_DARK, fontWeight: 600, marginBottom: 3 },
  metricValue: { fontSize: 16, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  metricPct: { fontSize: 10, color: MUTED, marginTop: 2 },
  divider: { height: 1, background: ROSE_TINT_STRONG, margin: "12px 0" },
  totalsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  totalBlockMuted: { background: "#2E2227", borderRadius: 7, padding: "11px 13px" },
  totalBlock: { background: ROSE_DARK, borderRadius: 7, padding: "11px 13px" },
  metricLabelOnDark: { fontSize: 10.5, color: "#D8B7C2", fontWeight: 600, marginBottom: 4 },
  bigValueMuted: { fontSize: 18, fontWeight: 700, color: "#F1E2E6", fontVariantNumeric: "tabular-nums" },
  bigValue: { fontSize: 20, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" },
  fxNote: { fontSize: 10, color: "#D8B7C2", marginTop: 3 },
};

/* ============================================================
   CLIENT-SIDE PASSWORD GATE
   Not real security -- this is a deterrent against a stray link
   reaching someone who shouldn't have it (e.g. a link accidentally
   left in a customer PDF), not a defense against a determined
   attacker. The check happens entirely in the browser; anyone who
   reads the JS source or network traffic could bypass it. Change
   GATE_PASSWORD below to whatever your team should use, and keep in
   mind it's visible to anyone who looks at this source file.
   ============================================================ */

const GATE_PASSWORD = "Admin@1234";
const GATE_SESSION_KEY = "jwy_gate_unlocked";

function PasswordGate({ onUnlock }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  const tryUnlock = (e) => {
    e.preventDefault();
    if (value === GATE_PASSWORD) {
      try {
        sessionStorage.setItem(GATE_SESSION_KEY, "true");
      } catch {}
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FFFCFD",
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <form
        onSubmit={tryUnlock}
        style={{
          background: "#fff",
          border: "1px solid #F3DCE3",
          borderRadius: 10,
          padding: "28px 30px",
          width: 300,
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "#241B1E" }}>Internal tool</div>
        <div style={{ fontSize: 12.5, color: "#8B7680", marginBottom: 16 }}>Enter the team password to continue.</div>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          style={{
            width: "100%",
            height: 36,
            padding: "0 10px",
            borderRadius: 6,
            border: `1px solid ${error ? "#B5651D" : "#F3DCE3"}`,
            fontSize: 13,
            marginBottom: 10,
            boxSizing: "border-box",
          }}
        />
        {error && <div style={{ fontSize: 11.5, color: "#B5651D", marginBottom: 10 }}>Incorrect password.</div>}
        <button
          type="submit"
          style={{
            width: "100%",
            height: 36,
            borderRadius: 6,
            border: "none",
            background: "#9C4A63",
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Continue
        </button>
      </form>
    </div>
  );
}

export default function JwyCalculator() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem(GATE_SESSION_KEY) === "true";
    } catch {
      return false;
    }
  });
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  return <JwyCalculatorApp />;
}
