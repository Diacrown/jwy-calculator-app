# JWY calculator

A standalone React app for jewelry casting/diamond/labor quoting.

## Run locally

```
npm install
npm run dev
```

Opens at http://localhost:5173

## Deploy for demo use (recommended path: Vercel)

1. Push this folder to a new GitHub repo.
2. Go to vercel.com, sign in, "Add New Project", import the repo.
3. Vercel auto-detects Vite. Click Deploy.
4. You get a public URL (e.g. jwy-calculator.vercel.app) anyone can open —
   no login required unless you add one.

Netlify works the same way (drag-and-drop the `dist/` folder after
`npm run build`, or connect the GitHub repo for auto-deploys on push).

## Wiring live data (fully automatic, no manual refresh needed)

This app reads all of its business data (metal rates, alloys, currency
rates, locations/duty, labor/CAD fees, setting tiers) from a Google
Sheet -- see `SHEET_SPEC.md` for the exact tab layout to build.

Once the sheet is built:

1. Publish each of its 6 tabs individually to the web as CSV
   (File > Share > Publish to web > select tab > CSV > Publish).
2. Paste the 6 resulting URLs into `src/config.js`.
3. Deploy. From then on the app polls all 6 sheets every 5 minutes
   (`POLL_INTERVAL_MS` in config.js) with zero human interaction --
   nobody needs to open the sheet, click refresh, or touch the app.
   The sheet's own IMPORTHTML/GOOGLEFINANCE formulas keep its data
   current on Google's own schedule; the app just reads whatever the
   sheet currently shows.

Each of the 6 tables falls back independently to bundled sample data if
its URL is left blank or its fetch fails (e.g. a typo in one tab's URL
doesn't take down the whole calculator) -- the "Live data sync" panel
in the app shows which tables are live vs sample at a glance, with a
manual "Sync now" button for on-demand refresh too.

This will not work from inside a claude.ai artifact preview (sandboxed,
no outbound network) but works normally once deployed to Vercel/Netlify
or any other real host.

## Known gaps / TODO

- DiaSize size-group mapping (small M-suffix stones -> DiaSSP R00-R25 rows)
  is an inferred approximation pending the real DiaSize column E values.
- TierTable (labor/markup tiers) not yet wired in -- left out per request.
- RM/findings catalog (chains, ear backs, posts) not yet mapped into the
  cost engine.
- CAD order form PDF upload is a UI stub -- needs a real sample PDF to
  build the field-extraction/mapping layer.
- Casting formula has been verified against real MetalMaster figures
  (gold/palladium base rates and 18KT YG / 18KT WG-PD landed rates all
  matched exactly; total landed at $503.57 vs a $504.00 screenshot
  reference, a rounding-level difference, not a structural one).
  Platinum and Silver alloy Casting/Gm and Surcharge/Gm values are still
  inferred placeholders -- paste those rows from MetalMaster to confirm.
- Labor, diamond, and setting totals have not yet been independently
  verified against real sheet output (only casting has been checked).
- fx rate / currency conversion is still sample data -- paste the
  Currency Rates table (J/K columns) to replace placeholders.

