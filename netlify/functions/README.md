SETUP STEPS — Netlify Database + Blobs (saved quote search)
==============================================================

These are one-time setup steps. Do them once, then the app's new
"search previous quotes" feature works automatically from then on.


STEP 1 — Provision the database
------------------------------------------------------------
Blob storage needs no setup at all (it auto-provisions the first time
a function uses it). The database needs one explicit step:

1. Install the Netlify CLI if you don't have it: `npm install -g netlify-cli`
2. In your project folder, run: `netlify login` (one-time, opens a browser)
3. Then run: `netlify db:init`
   This provisions a Postgres database for this site and automatically
   sets the NETLIFY_DATABASE_URL environment variable for you -- no
   connection strings to copy/paste anywhere.

Alternative if you'd rather not use the CLI: in the Netlify dashboard,
go to your site -> the "Database" section in the left sidebar -> click
to provision it there instead. Same result.


STEP 2 — Create the quotes table (run once)
------------------------------------------------------------
Open `netlify/functions/SETUP.sql` in this folder. You need to run
that SQL once against your new database. Easiest way:

1. Netlify dashboard -> your site -> Database section -> there's a
   SQL editor / query console built in.
2. Paste the full contents of SETUP.sql there and run it.
3. You should see "quotes" appear as a new table.

(If you'd rather use the CLI: `netlify db:query` or connect with any
Postgres client using the NETLIFY_DATABASE_URL from Step 1 -- either
works, the dashboard SQL editor is just the simplest for a one-off.)


STEP 3 — Push these files and deploy
------------------------------------------------------------
Push everything in this `netlify/functions/` folder plus the updated
`package.json` and `src/JwyCalculator.jsx` to your Testing branch as
usual. Netlify auto-detects files in `netlify/functions/` and deploys
them as serverless functions -- no extra configuration needed.


STEP 4 — Test it
------------------------------------------------------------
1. Fill out a quote, click Print (either mode).
2. It should still download the .zip exactly as before -- that part
   is unchanged. In the background, it also now saves a copy to the
   cloud. If that cloud save fails for any reason, the local download
   still succeeds either way -- you'll never lose a quote because of
   this new feature.
3. In the Quotes section, use the new search box -- type part of a Job#
   or Item# you just printed. It should show up in a dropdown within a
   second or two. Click it to reload that quote instantly, without
   needing the original .json file at all.


NOTES
------------------------------------------------------------
- Storage itself is free on your plan until at least July 1, 2026 per
  Netlify's own billing docs. Actual usage cost comes from database
  compute (10 credits per GB-hour) and function calls -- for a small
  team's quoting volume, this should be a tiny fraction of your
  1,000 credits/month Personal plan allowance. Keep an eye on your
  Netlify usage dashboard for the first few weeks just to confirm.
- The PDF is also stored in Blob storage but there's no "view saved
  PDF" button in the app yet -- only the JSON gets reloaded (which
  regenerates an identical PDF on demand anyway via Print). If you
  want a direct "download the original PDF" option later, that's a
  small addition on top of what's built now.
