# How to publish the JWY calculator (GitHub + Vercel)

Code lives on GitHub. Vercel hosts the running demo and rebuilds it
automatically every time you push a change. One-time setup below; after
that, updates are a single push.

---

## Before you start

You need:
- A GitHub account — github.com (free)
- A Vercel account — vercel.com (free; sign up WITH your GitHub account
  so it can see your repos)
- Either Git installed (git-scm.com) OR GitHub Desktop
  (desktop.github.com) if you prefer buttons over the terminal

Download and unzip jwy-calculator-app.zip first. Everything below happens
inside that unzipped folder.

---

## Step 1 — put the code on GitHub

### Option A: GitHub Desktop (easiest, no terminal)
1. Open GitHub Desktop, sign in.
2. File > Add Local Repository > pick the unzipped folder.
   It will say it's not a Git repo yet — click "create a repository".
3. Click "Publish repository" (top bar). Name it `jwy-calculator`.
   Leave "Keep this code private" checked or unchecked as you prefer.
4. Done — your code is on GitHub.

### Option B: terminal
From inside the unzipped folder:
```
git init
git add .
git commit -m "Initial JWY calculator"
```
Then make an empty repo on github.com (New repository, name it
`jwy-calculator`, do NOT add a README/gitignore), and run the lines
GitHub shows you, which look like:
```
git remote add origin https://github.com/YOUR-USERNAME/jwy-calculator.git
git branch -M main
git push -u origin main
```

---

## Step 2 — deploy on Vercel

1. Go to vercel.com, make sure you're signed in with GitHub.
2. Click "Add New…" > "Project".
3. Find `jwy-calculator` in the list, click "Import".
4. Vercel auto-detects Vite. Don't change any settings.
5. Click "Deploy". Wait ~1 minute.
6. You get a public URL like `jwy-calculator-xxxx.vercel.app`.
   Anyone can open it — that's your demo link.

---

## Step 3 — future updates

Any change you push to GitHub triggers an automatic Vercel rebuild.
So the loop is just:
- Replace/edit files in your local folder
- Commit + push (GitHub Desktop: "Commit to main" then "Push origin";
  terminal: `git add . && git commit -m "update" && git push`)
- Vercel redeploys in about a minute, same URL

---

## What works right away vs. what needs the sheet

The demo runs immediately on bundled SAMPLE data — full UI, full math,
good enough to show people how it works. The "Live data sync" panel will
show all six tables as "sample".

To switch on LIVE pricing:
1. Build the Google Sheet per SHEET_SPEC.md.
2. Publish each of its 6 tabs to web as CSV.
3. Paste the 6 URLs into `src/config.js`.
4. Commit + push. Vercel redeploys; the sync panel turns green per
   table as each connects.

You can do the live-data step later — it does not block getting a demo
link up now.

---

## If the deployed page is blank

Almost always one of:
- A syntax error from a hand-edit — check the Vercel build log (it
  shows the exact error and line).
- `node_modules` got committed — it shouldn't, the .gitignore prevents
  it; if it did, delete it from the repo and push again.
