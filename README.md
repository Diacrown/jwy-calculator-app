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

## Where the data comes from (no Google Sheet any more)

Every price / rate table (alloys, currency, locations & duty, labor/CAD fees,
setting tiers, natural / fancy / lab-grown prices, metal wastage & surcharge)
lives in `src/defaultData.js` as a permanent built-in copy. Changes are made
in the hidden **developer console**: open the site with `#/developer` on the
end of the address (it is not linked anywhere) and enter the developer token.
Stored changes are validated on the server, kept with a full change history
(with "put back"), and "Reset to built-in" removes them. If the data service
is ever unreachable the calculator simply keeps working on the built-in copy.

Set up once in Netlify (Site settings > Environment variables):

- `DEV_ADMIN_TOKEN` - a long random secret (16+ characters). Without it the
  console refuses everything. Never put it in the code or share it in chat.

Live feeds (all free, no keys): metal spot from gold-api.com with a PM
snapshot taken at each LBMA fix time (typed PM rates in the console override
it), and exchange rates from the European Central Bank via frankfurter.dev
(switch to "Manual" on the console's Currency tab to use fixed rates).

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

