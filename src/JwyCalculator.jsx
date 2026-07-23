import { useState, useMemo, useCallback, useEffect } from "react";
import { fetchLiveSheetData } from "./sheetData.js";
import { POLL_INTERVAL_MS } from "./config.js";
import { parseOrderFormJson } from "./pdfParser.js";
import { pdf } from "@react-pdf/renderer";
import JSZip from "jszip";
import { QuotePdfDocument } from "./pdfDocument.jsx";

const SAMPLE_METAL_RATES = {
  AU: { label: "Gold", pmRateOz: 4026.45, spotOz: 3984.96, spotSurcharge: 1.05, wastage: 1.1, asOf: "Mon 29 Jun 2026 PM" },
  PT: { label: "Platinum", pmRateOz: 1588.0, spotOz: 1566.5, spotSurcharge: 1.05, wastage: 1.22, asOf: "Mon 29 Jun 2026" },
  PD: { label: "Palladium", pmRateOz: 1212.0, spotOz: 1223.0, spotSurcharge: 1.05, wastage: 0.215, asOf: "Mon 29 Jun 2026" },
  AG: { label: "Silver", pmRateOz: 57.71, spotOz: 57.52, spotSurcharge: 1.05, wastage: 1.25, asOf: "Mon 29 Jun 2026" },
};

const SAMPLE_CURRENCY_RATES = { USD: 1.0, EUR: 0.93, AUD: 1.66, NZD: 1.81, GBP: 0.8, PLN: 4.15, INR: 86.5 };
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
  { code: "DIA", currency: "USD", duty: 0.0 },
  { code: "None", currency: "None", duty: 0.0 },
 ];

const ITEM_LETTER_TO_LOCATION = { T: "DMT", M: "WSME", S: "WSSY", B: "WSBN", N: "WSNZ", K: "WSUK", I: "WSIT", P: "WSPL" };

const SHAPE_ORDER = [
  "Round", "Baguette", "Carre", "Emerald", "Heart", "Marquise", "Oval",
  "Princess", "Pear", "Radiant", "Single Cut", "Sq. Cushion", "Sq. Emerald",
  "Tappered Bagguette", "Triangle", "Trilliant",
];

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

const LABOR_PER_GM = 22.0;
const LABOR_MIN_FLAT = 55.0;
const CAD_FEES = { None: 0, Simple: 50, Medium: 75, Complex: 100, Advanced: 200 };

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

const DIA_SIZE = [
  { code: "RND0.7M", key: "RND0.7M", shape: "Round", size: "0.7 mm (0.002 ct ±)", wt: 0.002, group: "R00" },
  { code: "RND0.8M", key: "RND0.8M", shape: "Round", size: "0.8 mm (0.003 ct ±)", wt: 0.003, group: "R00" },
  { code: "RND0.9M", key: "RND0.9M", shape: "Round", size: "0.9 mm (0.004 ct ±)", wt: 0.004, group: "R00" },
  { code: "RND1.0M", key: "RND1.0M", shape: "Round", size: "1.0 mm (0.005 ct ±)", wt: 0.005, group: "R00" },
  { code: "RND1.1M", key: "RND1.1M", shape: "Round", size: "1.1 mm (0.006 ct ±)", wt: 0.006, group: "R00" },
  { code: "RND1.2M", key: "RND1.2M", shape: "Round", size: "1.2 mm (0.008 ct ±)", wt: 0.008, group: "R00" },
  { code: "RND1.3M", key: "RND1.3M", shape: "Round", size: "1.3 mm (0.01 ct ±)", wt: 0.01, group: "R02" },
  { code: "RND1.4M", key: "RND1.4M", shape: "Round", size: "1.4 mm (0.012 ct ±)", wt: 0.012, group: "R02" },
  { code: "RND1.5M", key: "RND1.5M", shape: "Round", size: "1.5 mm (0.015 ct ±)", wt: 0.015, group: "R02" },
  { code: "RND1.6M", key: "RND1.6M", shape: "Round", size: "1.6 mm (0.017 ct ±)", wt: 0.017, group: "R02" },
  { code: "RND1.7M", key: "RND1.7M", shape: "Round", size: "1.7 mm (0.02 ct ±)", wt: 0.02, group: "R02" },
  { code: "RND1.8M", key: "RND1.8M", shape: "Round", size: "1.8 mm (0.023 ct ±)", wt: 0.023, group: "R02" },
  { code: "RND1.9M", key: "RND1.9M", shape: "Round", size: "1.9 mm (0.027 ct ±)", wt: 0.028, group: "R02" },
  { code: "RND2.0M", key: "RND2.0M", shape: "Round", size: "2.0 mm (0.03 ct ±)", wt: 0.032, group: "R02" },
  { code: "RND2.1M", key: "RND2.1M", shape: "Round", size: "2.1 mm (0.04 ct ±)", wt: 0.04, group: "R02" },
  { code: "RND2.2M", key: "RND2.2M", shape: "Round", size: "2.2 mm (0.045 ct ±)", wt: 0.045, group: "R02" },
  { code: "RND2.3M", key: "RND2.3M", shape: "Round", size: "2.3 mm (0.05 ct ±)", wt: 0.05, group: "R09" },
  { code: "RND2.4M", key: "RND2.4M", shape: "Round", size: "2.4 mm (0.055 ct ±)", wt: 0.055, group: "R09" },
  { code: "RND2.5M", key: "RND2.5M", shape: "Round", size: "2.5 mm (0.06 ct ±)", wt: 0.063, group: "R09" },
  { code: "RND2.6M", key: "RND2.6M", shape: "Round", size: "2.6 mm (0.07 ct ±)", wt: 0.073, group: "R09" },
  { code: "RND2.7M", key: "RND2.7M", shape: "Round", size: "2.7 mm (0.08ct ±)", wt: 0.08, group: "R11" },
  { code: "RND2.8M", key: "RND2.8M", shape: "Round", size: "2.8 mm (0.08-0.09 ct ±)", wt: 0.087, group: "R11" },
  { code: "RND2.9M", key: "RND2.9M", shape: "Round", size: "2.9 mm (0.09-0.10 ct ±)", wt: 0.097, group: "R12" },
  { code: "RND3.0M", key: "RND3.0M", shape: "Round", size: "3.0 mm (0.10-0.11 ct ±)", wt: 0.107, group: "R12" },
  { code: "RND3.1M", key: "RND3.1M", shape: "Round", size: "3.1 mm (0.11-0.12 ct ±)", wt: 0.117, group: "R12" },
  { code: "RND3.2M", key: "RND3.2M", shape: "Round", size: "3.2 mm (0.12-0.13 ct ±)", wt: 0.127, group: "R12" },
  { code: "RND3.3M", key: "RND3.3M", shape: "Round", size: "3.3 mm (0.14-0.145 ct ±)", wt: 0.143, group: "R12" },
  { code: "RND3.4M", key: "RND3.4M", shape: "Round", size: "3.4 mm (0.15-0.16 ct ±)", wt: 0.155, group: "R14" },
  { code: "RND3.5M", key: "RND3.5M", shape: "Round", size: "3.5 mm (0.16-0.17 ct ±)", wt: 0.165, group: "R14" },
  { code: "RND3.6M", key: "RND3.6M", shape: "Round", size: "3.6 mm (0.17-0.18 ct ±)", wt: 0.175, group: "R18" },
  { code: "RND3.7M", key: "RND3.7M", shape: "Round", size: "3.7 mm (0.19-0.21 ct ±)", wt: 0.2, group: "R20" },
  { code: "RND3.8M", key: "RND3.8M", shape: "Round", size: "3.8 mm (0.21-0.23 ct ±)", wt: 0.22, group: "R20" },
  { code: "RND3.9M", key: "RND3.9M", shape: "Round", size: "3.9 mm (0.23-0.24 ct ±)", wt: 0.235, group: "R23" },
  { code: "RND4.0M", key: "RND4.0M", shape: "Round", size: "4.0 mm (0.24-0.26 ct ±)", wt: 0.255, group: "R25" },
  { code: "RND4.1M", key: "RND4.1M", shape: "Round", size: "4.1 mm (0.26-0.29 ct ±)", wt: 0.275, group: "R25" },
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

const SAMPLE_LGD_BANDS = [
  { shape: "RND", minCt: 0.001, maxCt: 0.009, dvvs2: null, dvs1: null, nonCert: 135 },
  { shape: "RND", minCt: 0.01, maxCt: 0.49, dvvs2: null, dvs1: null, nonCert: 100 },
  { shape: "RND", minCt: 0.5, maxCt: 0.89, dvvs2: 230, dvs1: 200, nonCert: 100 },
  { shape: "FANCY", minCt: 0.5, maxCt: 0.89, dvvs2: 280, dvs1: 250, nonCert: 150 },
  { shape: "RND", minCt: 0.9, maxCt: 1.49, dvvs2: 170, dvs1: 160, nonCert: null },
  { shape: "FANCY", minCt: 0.9, maxCt: 1.49, dvvs2: 170, dvs1: 160, nonCert: null },
  { shape: "ODD", minCt: 0.01, maxCt: 3.99, dvvs2: null, dvs1: null, nonCert: 250 },
  { shape: "RND & FANCY", minCt: 1.5, maxCt: 1.99, dvvs2: 200, dvs1: 170, nonCert: null },
  { shape: "RND & FANCY", minCt: 2.0, maxCt: 3.99, dvvs2: 220, dvs1: 180, nonCert: null },
  { shape: "RND & FANCY", minCt: 4.0, maxCt: 4.99, dvvs2: 280, dvs1: 250, nonCert: null },
];
const LGD_GRADES = ["Non-cert", "D/VVS2", "D/VS1"];
const QUALITY_OPTIONS = [...NATURAL_GRADES, "Lab grown"];

const fmt = (n, dp = 2) =>
  isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "0.00";

const fmtCurrency = (n, dp = 2) => "$" + fmt(n, dp);

const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", AUD: "AUD $", NZD: "NZD $", PLN: "zł", INR: "₹" };
const fmtLocal = (n, currencyCode, dp = 2) => (CURRENCY_SYMBOLS[currencyCode] || "$") + fmt(n, dp);

const roundUp5 = (n) => (isFinite(n) ? Math.ceil(n / 5) * 5 : 0);

function emptyRow() {
  return { mode: "natural", stoneTypeSel: "Mined", shapeSel: "", sizeCode: "", quality: "TW SI1", lgdGrade: "Non-cert", lgdShape: "RND", pcs: "", customShape: "", customWt: "", customRate: "", manualRate: "" };
}


const CUSTOM_CODE = "__CUSTOM__";

const OWN_APP_DOMAIN_FRAGMENT = "jwy-calculator";
function isOwnAppLink(url) {
  return typeof url === "string" && url.toLowerCase().includes(OWN_APP_DOMAIN_FRAGMENT);
}

function baseNetRatePerGm(metalCode, metalRates) {
  const r = metalRates[metalCode];
  if (!r) return 0;
  const ozRate = r.pmRateOz;
  const wastage = r.wastage ?? 1;
  return Math.round(((ozRate / 31.1035) * wastage) * 100) / 100;
}

function alloyRatePerGm(alloy, metalRates) {
  const base = baseNetRatePerGm(alloy.metal, metalRates);
  const pdKicker = alloy.short.includes("WG-PD") ? baseNetRatePerGm("PD", metalRates) : 0;
  return base * alloy.purity + pdKicker;
}

function castingCost(gramWt, alloy, metalRates) {
  if (!alloy || gramWt <= 0) return 0;
  const rateNet = alloyRatePerGm(alloy, metalRates) + alloy.castingGm;
  const rateNetSurcharge = rateNet + alloy.surchargeGm;
  const minGms = alloy.minGms ?? 0;
  if (gramWt < minGms) {
    return Math.min(gramWt * rateNetSurcharge, minGms * rateNet);
  }
  return gramWt * rateNet;
}

function JwyCalculatorApp() {
  const [jobInfo, setJobInfo] = useState({
    designer: "",
    jobNo: "",
    itemNo: "",
    itemSize: "",
    customer: "",
    cadType: "Medium",
    remarks: "",
  });
  const [location, setLocation] = useState("WSSY");
  const [quoteStage, setQuoteStage] = useState("Q1");
  const [printDate, setPrintDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualPriceOverride, setManualPriceOverride] = useState("");
  const [primaryAlloyShort, setPrimaryAlloyShort] = useState("");
  const [primaryGramWt, setPrimaryGramWt] = useState("");
  const [secondaryAlloyShort, setSecondaryAlloyShort] = useState("");
  const [secondaryGramWt, setSecondaryGramWt] = useState("");
  const [rows, setRows] = useState(Array.from({ length: 5 }, emptyRow));
  const [savedQuotes, setSavedQuotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("jwyQuotes") || "[]");
    } catch {
      return [];
    }
  });
  const [pdfStatus, setPdfStatus] = useState("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfImport, setPdfImport] = useState(null);
  const [cadImages, setCadImages] = useState([]);
  const [clientRefImages, setClientRefImages] = useState([]);
  const [turntableLink, setTurntableLink] = useState("");

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

  const applyImportResult = async (fileName, resultData) => {
    const { jobInfo: ji, metals, metalWarnings, stones, cadImageDataUrls, clientRefImageDataUrls, derivedSummary } = resultData;
    if (cadImageDataUrls?.length) {
      const compressed = await Promise.all(cadImageDataUrls.map((u) => compressDataUrl(u)));
      setCadImages((prev) => [...compressed, ...prev]);
    }
    if (clientRefImageDataUrls?.length) {
      const compressed = await Promise.all(clientRefImageDataUrls.map((u) => compressDataUrl(u)));
      setClientRefImages((prev) => [...compressed, ...prev]);
    }

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
      await applyImportResult(file.name, result.data);
    } catch (err) {
      setPdfStatus("error");
      setPdfImport({ error: (err && err.message) || String(err) });
    }
  };

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
    setPrimaryAlloyShort("");
    setPrimaryGramWt("");
    setSecondaryAlloyShort("");
    setSecondaryGramWt("");
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

  const loadFromCloud = async (filenameBase) => {
    const res = await fetch(`/.netlify/functions/load-quote?filenameBase=${encodeURIComponent(filenameBase)}`);
    if (!res.ok) throw new Error("Couldn't load that quote from the cloud");
    const snapshot = await res.json();
    applySnapshot(snapshot);
  };

  const quoteFilenameBase = () => {
    const parts = [jobInfo.jobNo, jobInfo.itemNo].filter(Boolean);
    const base = parts.length ? parts.join("_") : "quote";
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${base}_${stamp}`;
  };

  const buildSnapshotJsonBlob = () => {
    const snapshot = buildSnapshot();
    return new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  };

  const [manualRatesOn, setManualRatesOn] = useState(false);
  const [manualRates, setManualRates] = useState(SAMPLE_METAL_RATES);

  const metalRates = manualRatesOn ? manualRates : liveData.metalRates;
  const toggleManualRates = () => {
    if (!manualRatesOn) {
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

  const addCustomRow = () => {
    setRows((prev) => {
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
        const settingTotal = isMount ? 0 : pcs > 0 ? (tier.type === "PER CT" ? tier.rate * totalWt : tier.rate * pcs) : 0;
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
      const stoneType = row.stoneTypeSel || "Mined";
      const isOtherType = stoneType !== "Mined" && stoneType !== "Lab grown";

      let perCt = 0;
      let priceEditable = false;
      if (isOtherType) {
        perCt = parseFloat(row.manualRate) || 0;
        priceEditable = true;
      } else if (isNatural) {
        if (sizeEntry.group) {
          const grid = (liveData.naturalPrices || SAMPLE_NATURAL_PRICES)[sizeEntry.group];
          const gridPrice = grid?.[row.quality];
          if (gridPrice) {
            perCt = gridPrice;
          } else {
            // Blank cell in the grid (e.g. TW VS/TW SI1 aren't offered at the
            // R70/R75/R80 tiers) -- no real price exists here, so fall back
            // to manual entry instead of silently pricing this at $0.
            perCt = parseFloat(row.manualRate) || 0;
            priceEditable = true;
          }
        } else {
          perCt = parseFloat(row.manualRate) || 0;
          priceEditable = true;
        }
      } else {
        const wtPerPc = sizeEntry.wt;
        const lgdBands = liveData.labGrownPrices || SAMPLE_LGD_BANDS;
        const band = lgdBands.find(
          (b) => (b.shape === row.lgdShape || b.shape === "RND & FANCY") && wtPerPc >= b.minCt && wtPerPc <= b.maxCt
        );
        if (band) {
          if (row.lgdGrade === "D/VVS2") perCt = band.dvvs2 || 0;
          else if (row.lgdGrade === "D/VS1") perCt = band.dvs1 || 0;
          else perCt = band.nonCert || 0;
        }
      }

      const total = totalWt * perCt;
      const tier = settingRateFor(sizeEntry.wt, settingTiersLive);
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

  const cadFee = Math.round(liveData.cadFees[jobInfo.cadType] ?? 0);
  const grossTotalUSD = casting + labor + cadFee + totals.diamondTotal + totals.settingTotal;
  const locInfo = locationList.find((l) => l.code === location) || locationList[0];
  const fxRate = locInfo.currency === "USD" ? 1 : (currencyRates[locInfo.currency] || 1) * liveData.currencyMarkup;
  const totalWithDutyUSD = roundUp5(grossTotalUSD * (1 + locInfo.duty));
  const totalWithDutyLocal = roundUp5(totalWithDutyUSD * fxRate);

  const overrideNum = parseFloat(manualPriceOverride);
  const hasOverride = manualPriceOverride !== "" && isFinite(overrideNum) && overrideNum > 0;
  const effectiveTotalLocal = hasOverride ? overrideNum : totalWithDutyLocal;
  const breakupPct = (val) => (grossTotalUSD > 0 ? (val / grossTotalUSD) * 100 : 0);

  const [pdfGenerating, setPdfGenerating] = useState(null);

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
        clientRefImages={clientRefImages}
        turntableLink={turntableLink}
        quoteStage={quoteStage}
        hasOverride={hasOverride}
        effectiveTotalLocal={effectiveTotalLocal}
        logoBlack="/logoblack.PNG"
        printDate={printDate}
      />
    ).toBlob();
  };

  const doPreview = async (variant) => {
    setPdfGenerating(variant + "-preview");
    try {
      const pdfBlob = await generatePdfBlob(variant);
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank");
    } catch (err) {
      alert("Couldn't generate the PDF: " + ((err && err.message) || String(err)));
    } finally {
      setPdfGenerating(null);
    }
  };

  // Branded HTML email body -- same template regardless of which print
  // variant (full/priceOnly/noPrice) is attached, since the email itself
  // never repeats pricing, only the job reference. The PDF attachment is
  // what actually varies by variant.
  const buildEmailHtml = () => {
    const refLine = [
      jobInfo.jobNo ? `Job ${jobInfo.jobNo}` : null,
      jobInfo.itemNo ? `Item ${jobInfo.itemNo}` : null,
      quoteStage || null,
    ]
      .filter(Boolean)
      .join(" · ");
    const greetingName = jobInfo.customer ? jobInfo.customer : "there";

    return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; color: #241B1E;">
  <div style="background: #241B1E; padding: 20px 24px; border-bottom: 3px solid #9C4A63;">
    <div style="color: #fff; font-size: 15px; font-weight: 600; letter-spacing: 0.3px;">World Shiner</div>
    <div style="color: #D8B7C2; font-size: 11px; margin-top: 2px;">Fine Jewelry Manufacturing</div>
  </div>
  <div style="padding: 28px 24px;">
    <p style="font-size: 14px; line-height: 1.6;">Dear ${greetingName},</p>
    <p style="font-size: 14px; line-height: 1.6;">
      Thank you for the opportunity to quote your piece. Please find your quotation attached as a PDF.
    </p>
    ${
      refLine
        ? `<div style="background: #FBEEF2; border-radius: 6px; padding: 14px 16px; margin: 20px 0; font-size: 13px;">
      <div style="color: #6E2F42; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; margin-bottom: 6px;">Job Reference</div>
      <div>${refLine}</div>
    </div>`
        : ""
    }
    <p style="font-size: 14px; line-height: 1.6;">
      If you have any questions about this quotation, or would like to discuss adjustments, please don't hesitate to reach out.
    </p>
    <p style="font-size: 14px; line-height: 1.6; margin-top: 24px;">
      Warm regards,<br/>
      <strong>World Shiner</strong>
    </p>
  </div>
  <div style="padding: 14px 24px; border-top: 1px solid #F3DCE3; font-size: 10.5px; color: #8B7680;">
    This quotation is an internal reference and subject to final confirmation.
  </div>
</div>`.trim();
  };

  const doEmail = async (variant, toEmail) => {
    const filenameBase = quoteFilenameBase();
    const pdfBlob = await generatePdfBlob(variant);
    const pdfBase64 = await blobToBase64(pdfBlob);
    const res = await fetch("/.netlify/functions/send-quote-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: toEmail,
        subject: `Your Quotation — ${jobInfo.jobNo || filenameBase} · World Shiner`,
        message: "Please find your quotation attached as a PDF.",
        html: buildEmailHtml(),
        filenameBase,
        pdfBase64,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't send the email");
    return data;
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
    } catch (err) {
      alert("Couldn't generate the PDF: " + ((err && err.message) || String(err)));
    } finally {
      setPdfGenerating(null);
    }
  };

  const doSyncToDb = async () => {
    const filenameBase = quoteFilenameBase();
    const pdfBlob = await generatePdfBlob("full");
    const jsonBlob = buildSnapshotJsonBlob();
    const pdfBase64 = await blobToBase64(pdfBlob);
    const jsonText = await jsonBlob.text();
    const res = await fetch("/.netlify/functions/save-quote", {
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't save to the database");
    return data;
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
          printDate={printDate}
          setPrintDate={setPrintDate}
          loadFromCloud={loadFromCloud}
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
          onEmail={doEmail}
          onSyncToDb={doSyncToDb}
          quoteStage={quoteStage}
          setQuoteStage={setQuoteStage}
          pdfGenerating={pdfGenerating}
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
          <div style={styles.brandLogoBox}>
            <img src="/logowhite.PNG" alt="Made with Love" style={{ height: 38, width: "auto", display: "block" }} />
          </div>
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

function JobInfoCard({ jobInfo, setJobInfo, location, setLocation, locationList, cadFees, turntableLink, setTurntableLink, printDate, setPrintDate, loadFromCloud }) {
  return (
    <div style={styles.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <SectionLabel eyebrow="01" title="Job details" noMargin />
        <CloudQuoteSearch loadFromCloud={loadFromCloud} />
      </div>
      <div style={{ ...styles.fieldRow, marginTop: 10 }}>
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
        <Field label="Date">
          <input
            type="date"
            style={styles.input}
            value={printDate}
            onChange={(e) => setPrintDate(e.target.value)}
            title="Date shown on the printed quote -- defaults to today, editable"
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

function compressDataUrl(dataUrl, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

function fileToDataUrl(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve(reader.result);
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
            <option value="">Select alloy…</option>
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
    }, 350);
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

function QuotesToolbar({ savedQuotes, onSave, onLoad, onDelete, onPrint, onPreview, onEmail, onSyncToDb, quoteStage, setQuoteStage, pdfGenerating }) {
  const [selected, setSelected] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailVariant, setEmailVariant] = useState("full");
  const [emailStatus, setEmailStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [printVariant, setPrintVariant] = useState("full");

  const sendEmail = async () => {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    try {
      await onEmail(emailVariant, emailTo.trim());
      setEmailStatus("sent");
      setTimeout(() => setEmailStatus(""), 3000);
    } catch (err) {
      setEmailStatus((err && err.message) || "Couldn't send");
    }
  };

  const syncToDb = async () => {
    setSyncStatus("syncing");
    try {
      await onSyncToDb();
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus(""), 3000);
    } catch (err) {
      setSyncStatus((err && err.message) || "Couldn't save");
    }
  };

  const Divider = () => <div style={styles.toolbarDivider} />;

  return (
    <div style={styles.card}>
      <SectionLabel eyebrow="04" title="Quotes" />
      <div style={styles.toolbarRow}>
        <div style={styles.toolbarGroup}>
          <span style={styles.toolbarGroupLabel}>Stage</span>
          <input
            style={{ ...styles.inputSm, width: 52, textAlign: "center", fontWeight: 600 }}
            value={quoteStage}
            onChange={(e) => setQuoteStage(e.target.value)}
            placeholder="Q1"
            title="Which round of quoting this is -- Q1, Q2, Revised, etc."
          />
        </div>

        <Divider />

        <div style={styles.toolbarGroup}>
          <span style={styles.toolbarGroupLabel}>This device</span>
          <button style={styles.smallBtn} onClick={onSave} type="button">
            Save
          </button>
          <select
            style={{ ...styles.inputSm, minWidth: 150, maxWidth: 150 }}
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
          <button style={styles.smallBtn} type="button" disabled={!selected} onClick={() => selected && onLoad(Number(selected))}>
            Load
          </button>
          <button
            style={{ ...styles.smallBtn, ...styles.smallBtnDanger }}
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
        </div>

        <Divider />

        <div style={styles.toolbarGroup}>
          <span style={styles.toolbarGroupLabel}>Print</span>
          <select
            style={{ ...styles.inputSm, width: 108 }}
            value={printVariant}
            onChange={(e) => setPrintVariant(e.target.value)}
          >
            <option value="full">Full price</option>
            <option value="priceOnly">Price only</option>
            <option value="noPrice">No price</option>
          </select>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: pdfGenerating ? 0.6 : 1 }}>
            <button
              style={styles.toggleBtnActive}
              onClick={() => onPrint(printVariant)}
              type="button"
              disabled={!!pdfGenerating}
            >
              {pdfGenerating === printVariant ? "Generating…" : "Download"}
            </button>
            <button
              title="Preview without downloading"
              style={{ ...styles.toggleBtnActive, padding: "7px 9px" }}
              onClick={() => onPreview(printVariant)}
              type="button"
              disabled={!!pdfGenerating}
            >
              {pdfGenerating === printVariant + "-preview" ? "…" : "👁"}
            </button>
          </div>
        </div>

        <Divider />

        <div style={styles.toolbarGroup}>
          <span style={styles.toolbarGroupLabel}>Cloud</span>
          <button
            style={{ ...styles.smallBtn, ...styles.smallBtnAccent }}
            type="button"
            disabled={syncStatus === "syncing"}
            onClick={syncToDb}
          >
            {syncStatus === "syncing" ? "Saving…" : "Sync to DB"}
          </button>
          {syncStatus === "synced" && <span style={styles.statusOk}>✓ Saved</span>}
          {syncStatus && syncStatus !== "syncing" && syncStatus !== "synced" && (
            <span style={styles.statusWarn} title={syncStatus}>
              {syncStatus.length > 40 ? syncStatus.slice(0, 40) + "…" : syncStatus}
            </span>
          )}
        </div>

        <Divider />

        <div style={{ ...styles.toolbarGroup, marginLeft: "auto" }}>
          {!emailOpen ? (
            <button style={styles.smallBtn} type="button" onClick={() => setEmailOpen(true)}>
              ✉ Email quote
            </button>
          ) : (
            <>
              <input
                type="email"
                autoFocus
                style={{ ...styles.inputSm, width: 150 }}
                placeholder="Recipient email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
              <select style={{ ...styles.inputSm, width: 96 }} value={emailVariant} onChange={(e) => setEmailVariant(e.target.value)}>
                <option value="full">Full price</option>
                <option value="priceOnly">Price only</option>
                <option value="noPrice">No price</option>
              </select>
              <button
                style={{ ...styles.smallBtn, ...styles.smallBtnAccent }}
                type="button"
                disabled={!emailTo.trim() || emailStatus === "sending"}
                onClick={sendEmail}
              >
                {emailStatus === "sending" ? "Sending…" : "Send"}
              </button>
              <button
                style={{ ...styles.smallBtn, background: "none" }}
                type="button"
                onClick={() => {
                  setEmailOpen(false);
                  setEmailStatus("");
                }}
              >
                ×
              </button>
              {emailStatus === "sent" && <span style={styles.statusOk}>✓ Sent</span>}
              {emailStatus && emailStatus !== "sending" && emailStatus !== "sent" && (
                <span style={styles.statusWarn}>{emailStatus}</span>
              )}
            </>
          )}
        </div>
      </div>
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
  brandLogoBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
  },
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
  smallBtnDanger: { color: "#B5651D", borderColor: "#F0D9BE", background: "#FDF6EC" },
  smallBtnAccent: { background: ROSE, color: "#fff", borderColor: ROSE },
  toolbarRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 10,
  },
  toolbarGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  toolbarGroupLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginRight: 2,
    whiteSpace: "nowrap",
  },
  toolbarDivider: {
    width: 1,
    alignSelf: "stretch",
    background: ROSE_TINT_STRONG,
    flexShrink: 0,
  },
  statusOk: { fontSize: 11, color: "#3A7D5C", whiteSpace: "nowrap" },
  statusWarn: { fontSize: 10.5, color: "#B5651D", whiteSpace: "nowrap", maxWidth: 200 },
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
