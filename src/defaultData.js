// ============================================================================
// BUILT-IN DATA -- the permanent copy of every price / rate table the
// calculator uses. This replaces the old Google "DATA TABLE" sheet.
//
// How the data reaches the calculator:
//   1. These built-in values are always present in the app (nothing to fetch,
//      nothing that can be edited by accident).
//   2. The hidden developer console can store replacement values for any table
//      (see netlify/functions/dev-admin.mjs). The calculator merges those over
//      these built-ins, table by table. "Reset" in the console simply removes
//      the replacement, so the built-in values apply again.
//   3. If the data service cannot be reached, the calculator runs on these
//      built-ins -- it never stops working.
//
// Snapshot taken from the live DATA TABLE sheet on 15 Oct 2026. Edit these
// only to change the *factory defaults*; day-to-day changes belong in the
// developer console.
// ============================================================================
import { FANCY_PRICES } from "./fancyPrices.js";

// Last-resort metal rates (only used when the live-rate service is down).
export const SAMPLE_METAL_RATES = {
  AU: { label: "Gold", pmRateOz: 4089.25, spotOz: 4150.78, spotSurcharge: 1.05, wastage: 1.1, asOf: "Wed 14 Oct 2026 PM" },
  PT: { label: "Platinum", pmRateOz: 1635.3, spotOz: 1621.0, spotSurcharge: 1.05, wastage: 1.22, asOf: "Wed 14 Oct 2026" },
  PD: { label: "Palladium", pmRateOz: 1117.6, spotOz: 1134.0, spotSurcharge: 1.05, wastage: 0.215, asOf: "Wed 14 Oct 2026" },
  AG: { label: "Silver", pmRateOz: 58.49, spotOz: 57.03, spotSurcharge: 1.05, wastage: 1.25, asOf: "Wed 14 Oct 2026" },
};

// Last-resort FX (USD -> currency) and the markup applied on top of it.
export const SAMPLE_CURRENCY_RATES = { USD: 1.0, EUR: 0.89241, AUD: 1.4472, NZD: 1.78408949, GBP: 0.754495, PLN: 3.89740016, INR: 94.78 };
export const CURRENCY_MARKUP = 1.05;

export const LOCATIONS = [
  { code: "DMG", currency: "EUR", duty: 0.03 },
  { code: "DMT", currency: "USD", duty: 0.2 },
  { code: "WSME", currency: "AUD", duty: 0.05 },
  { code: "WSSY", currency: "AUD", duty: 0.05 },
  { code: "WSBN", currency: "AUD", duty: 0.05 },
  { code: "WSNZ", currency: "NZD", duty: 0.05 },
  { code: "WSUK", currency: "GBP", duty: 0.02 },
  { code: "WSIT", currency: "EUR", duty: 0.02 },
  { code: "WSPL", currency: "PLN", duty: 0.02 },
  { code: "DMR", currency: "INR", duty: 0 },
  { code: "DIA", currency: "USD", duty: 0 },
  { code: "AU NO DUTY", currency: "AUD", duty: 0 },
  { code: "IT NO DUTY", currency: "EUR", duty: 0 },
  { code: "PL NO DUTY", currency: "PLN", duty: 0 },
  { code: "NZ NO DUTY", currency: "NZD", duty: 0 },
  { code: "UK NO DUTY", currency: "GBP", duty: 0 },
];

export const ALLOYS = [
  { name: "Standard Injection Wax", short: "Wax", sg: 0.96, purity: 1.0, metal: "WX", castingGm: 1.0, surchargeGm: 1.0, minGms: 7.0 },
  { name: "United Casting Bronze #342", short: "Brass", sg: 8.5, purity: 1.0, metal: "AY", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Standard 925 Silver", short: "AG925", sg: 10.3, purity: 0.925, metal: "AG", castingGm: 15.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Argentium Silver (935)", short: "AG935", sg: 10.4, purity: 0.935, metal: "AG", castingGm: 15.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 600", short: "PT600", sg: 13.05, purity: 0.6, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 900", short: "PT900", sg: 20.0, purity: 0.9, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
  { name: "Platinum 950", short: "PT950", sg: 21.5, purity: 0.952, metal: "PT", castingGm: 10.0, surchargeGm: 5.0, minGms: 7.0 },
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
];

export const LABOR_PER_GM = 22.0;
export const LABOR_MIN_FLAT = 55.0;
export const CAD_FEES = { None: 0, Simple: 50, Medium: 75, Complex: 100, Advanced: 200 };

export const SETTING_TIERS = [
  { uptoCt: 0.04, rate: 1.0, type: "PER PC" },
  { uptoCt: 0.09, rate: 2.25, type: "PER PC" },
  { uptoCt: 0.14, rate: 3.5, type: "PER PC" },
  { uptoCt: 0.19, rate: 4.75, type: "PER PC" },
  { uptoCt: 0.29, rate: 7.5, type: "PER PC" },
  { uptoCt: 99.0, rate: 25.0, type: "PER CT" },
];

export const SAMPLE_NATURAL_PRICES = {
  R00: { "TW VS": 450, "TW SI1": 410, "TW SI2": 380, "TW SI3": 360, "TW I1": 330, "WH SI": 300, "IJ SI2-I1": 270 },
  R02: { "TW VS": 380, "TW SI1": 350, "TW SI2": 330, "TW SI3": 320, "TW I1": 290, "WH SI": 260, "IJ SI2-I1": 230 },
  R09: { "TW VS": 490, "TW SI1": 450, "TW SI2": 420, "TW SI3": 400, "TW I1": 360, "WH SI": 330, "IJ SI2-I1": 300 },
  R11: { "TW VS": 540, "TW SI1": 490, "TW SI2": 450, "TW SI3": 430, "TW I1": 390, "WH SI": 360, "IJ SI2-I1": 330 },
  R12: { "TW VS": 620, "TW SI1": 560, "TW SI2": 520, "TW SI3": 500, "TW I1": 450, "WH SI": 400, "IJ SI2-I1": 360 },
  R13: { "TW VS": 650, "TW SI1": 600, "TW SI2": 540, "TW SI3": 520, "TW I1": 490, "WH SI": 450, "IJ SI2-I1": 410 },
  R14: { "TW VS": 650, "TW SI1": 600, "TW SI2": 540, "TW SI3": 520, "TW I1": 490, "WH SI": 450, "IJ SI2-I1": 410 },
  R18: { "TW VS": 650, "TW SI1": 600, "TW SI2": 540, "TW SI3": 520, "TW I1": 490, "WH SI": 450, "IJ SI2-I1": 410 },
  R20: { "TW VS": 740, "TW SI1": 690, "TW SI2": 630, "TW SI3": 610, "TW I1": 530, "WH SI": 500, "IJ SI2-I1": 450 },
  R23: { "TW VS": 760, "TW SI1": 720, "TW SI2": 660, "TW SI3": 630, "TW I1": 550, "WH SI": 500, "IJ SI2-I1": 490 },
  R25: { "TW VS": 760, "TW SI1": 720, "TW SI2": 660, "TW SI3": 630, "TW I1": 550, "WH SI": 530, "IJ SI2-I1": 490 },
  R30: { "TW VS": 800, "TW SI1": 740, "TW SI2": 670, "TW SI3": 640, "TW I1": 580, "WH SI": 550, "IJ SI2-I1": 500 },
  R38: { "TW VS": 930, "TW SI1": 850, "TW SI2": 770, "TW SI3": 750, "TW I1": 660, "WH SI": 600, "IJ SI2-I1": 550 },
  R40: { "TW VS": 950, "TW SI1": 870, "TW SI2": 790, "TW SI3": 770, "TW I1": 670, "WH SI": 620, "IJ SI2-I1": 560 },
  R46: { "TW SI2": 800, "TW SI3": 760, "TW I1": 690, "WH SI": 640, "IJ SI2-I1": 590 },
  R50: { "TW SI2": 820, "TW SI3": 790, "TW I1": 700, "WH SI": 650, "IJ SI2-I1": 600 },
  R60: { "TW SI2": 850, "TW SI3": 830, "TW I1": 730, "WH SI": 670, "IJ SI2-I1": 620 },
  R70: { "TW SI2": 1000, "TW SI3": 980, "TW I1": 800, "WH SI": 720, "IJ SI2-I1": 650 },
  R75: { "TW SI2": 1000, "TW SI3": 980, "TW I1": 800, "WH SI": 720, "IJ SI2-I1": 650 },
  R80: { "TW SI2": 1150, "TW SI3": 1100, "TW I1": 900, "WH SI": 750, "IJ SI2-I1": 700 },
};

export const SAMPLE_LGD_BANDS = [
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

// Metal pricing policy (business settings, not market data). The market rate
// itself comes from the live-rate service; these are what we add on top.
export const DEFAULT_METAL_POLICY = {
  AU: { wastage: 1.1, spotSurcharge: 1.05 },
  PT: { wastage: 1.22, spotSurcharge: 1.05 },
  PD: { wastage: 0.215, spotSurcharge: 1.05 },
  AG: { wastage: 1.25, spotSurcharge: 1.05 },
};

// Everything in one object, in the shape the calculator keeps in state.
export const DEFAULT_DATA = {
  metalRates: SAMPLE_METAL_RATES,
  metalPolicy: DEFAULT_METAL_POLICY,
  alloys: ALLOYS,
  currencyRates: SAMPLE_CURRENCY_RATES,
  currencyMarkup: CURRENCY_MARKUP,
  // "live" = FX rates come from a free daily feed (as the old sheet's Google Finance did);
  // "manual" = always use the rates stored here / in the developer console.
  currencyMode: "live",
  locations: LOCATIONS,
  laborPerGm: LABOR_PER_GM,
  laborMinFlat: LABOR_MIN_FLAT,
  cadFees: CAD_FEES,
  settingTiers: SETTING_TIERS,
  naturalPrices: SAMPLE_NATURAL_PRICES,
  fancyPrices: FANCY_PRICES,
  labGrownPrices: SAMPLE_LGD_BANDS,
};
