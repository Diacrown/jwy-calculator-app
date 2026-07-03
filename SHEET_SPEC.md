# JWY calculator — live data sheet spec

Build this as a brand new Google Sheet, separate from your working
calculator sheet. Six tabs, exact column layout below. Each tab gets
published to web as CSV individually (File > Share > Publish to web >
select the specific sheet/tab > CSV > Publish). You'll end up with six
CSV URLs, one per tab — paste all six into the app config in one place.

Keep formulas ONLY in this sheet. The app never writes back to Sheets —
read-only, one direction, fully automatic once published.

---

## Tab 1: MetalRates

| A (metal) | B (label) | C (pmRateOz) | D (spotOz) | E (spotSurcharge) | F (wastage) | G (asOf) |
|---|---|---|---|---|---|---|
| AU | Gold | `=INDEX(IMPORTHTML("https://www.cooksongold.com/metalprices/","table",1),4,3)` | `=VLOOKUP("Gold", IMPORTHTML("https://markets.businessinsider.com/commodities","table",2),2,FALSE)` | 1.05 | 1.1 | `=NOW()` |
| PT | Platinum | `=INDEX(IMPORTHTML("https://www.cooksongold.com/metalprices/","table",1),7,3)` | `=VLOOKUP("Platinum", IMPORTHTML(...),2,FALSE)` | 1.05 | 1.22 | `=NOW()` |
| PD | Palladium | `=INDEX(...,6,3)` | `=VLOOKUP("Palladium",...)` | 1.05 | 0.215 | `=NOW()` |
| AG | Silver | `=INDEX(...,2,3)` | `=VLOOKUP("Silver",...)` | 1.05 | 1.25 | `=NOW()` |

(Row 1 = headers: metal, label, pmRateOz, spotOz, spotSurcharge, wastage, asOf)
This is exactly your existing MetalMaster columns B-H — just copy that
logic in, four rows only.

## Tab 2: Alloys

Headers: `name, short, sg, purity, metal, castingGm, surchargeGm`

23 rows, one per alloy (9KT WG through 24KT, PT600/900/950, AG925, AG935).
Pull straight from your MetalMaster alloy table — copy name, short name,
specific gravity, purity, metal type, Casting/Gm, Surcharge/Gm columns
exactly as they are now (no formulas needed here, these are static
reference values you adjust manually when costs change).

## Tab 3: CurrencyRates

Headers: `currency, rateToUSD, markup`

| currency | rateToUSD | markup |
|---|---|---|
| USD | 1.00 | 1.00 |
| EUR | `=GOOGLEFINANCE("CURRENCY:USD","EUR")` | 1.05 |
| AUD | `=GOOGLEFINANCE("CURRENCY:USDAUD")` | 1.05 |
| NZD | `=GOOGLEFINANCE("CURRENCY:USDNZD")` | 1.05 |
| GBP | `=GOOGLEFINANCE("CURRENCY:USDGBP")` | 1.05 |
| PLN | `=GOOGLEFINANCE("CURRENCY:USDPLN")` | 1.05 |
| INR | `=GOOGLEFINANCE("CURRENCY:USDINR")` | 1.05 |

## Tab 4: Locations

Headers: `code, currency, duty`

| code | currency | duty |
|---|---|---|
| DMG | EUR | 0.03 |
| DMT | USD | 0.20 |
| WSME | AUD | 0.05 |
| WSSY | AUD | 0.05 |
| WSBN | AUD | 0.05 |
| WSNZ | NZD | 0.05 |
| WSUK | GBP | 0.02 |
| WSIT | EUR | 0.02 |
| WSPL | PLN | 0.02 |
| DMR | INR | 0.00 |

## Tab 5: CadFeesAndLabor

Headers: `key, value`

| key | value |
|---|---|
| laborPerGm | 22.00 |
| laborMinFlat | 55.00 |
| cadNone | 0 |
| cadSimple | 50 |
| cadMedium | 75 |
| cadComplex | 100 |
| cadAdvanced | 200 |

## Tab 6: SettingTiers

Headers: `uptoCt, rate, type`

| uptoCt | rate | type |
|---|---|---|
| 0.04 | 1.00 | PER PC |
| 0.09 | 2.25 | PER PC |
| 0.14 | 3.50 | PER PC |
| 0.19 | 4.75 | PER PC |
| 0.29 | 7.50 | PER PC |
| 99.00 | 25.00 | PER CT |

---

## Publishing each tab

For each of the 6 tabs:
1. File > Share > Publish to web
2. In the dropdown, select the specific tab (not "Entire document")
3. Format: CSV
4. Click Publish, copy the URL (ends in `/pub?gid=XXXXX&single=true&output=csv`)

You'll have 6 URLs. Paste them into `src/config.js` in the app (created
below) — that's the only place they need to live.

## Refresh behavior

Google Sheets formulas like IMPORTHTML and GOOGLEFINANCE auto-refresh on
their own schedule (typically hourly for IMPORTHTML, near-real-time for
GOOGLEFINANCE) — Google controls that cadence, not you. The published
CSV reflects whatever the sheet's current calculated values are at fetch
time. The app polls the CSV every few minutes; the sheet itself updates
independently in the background. No one has to open the sheet, click
anything, or manually refresh for this to stay current.
