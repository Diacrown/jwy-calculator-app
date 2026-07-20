-- Run this ONCE against your Netlify Database before the search/save
-- feature will work. See netlify/functions/README.md for exactly how
-- and where to run it.

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  job_no TEXT,
  item_no TEXT,
  quote_stage TEXT,
  filename_base TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Speeds up the search-quotes function's lookups.
CREATE INDEX IF NOT EXISTS idx_quotes_job_no ON quotes (job_no);
CREATE INDEX IF NOT EXISTS idx_quotes_item_no ON quotes (item_no);
