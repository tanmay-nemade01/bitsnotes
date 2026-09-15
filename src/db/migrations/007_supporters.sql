-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 007: Supporters (Wall of Gratitude)
--
-- Supporters used to be hard-coded in `src/data/supporters.ts`, which meant
-- every new backer needed a code change + redeploy. They now live in D1 and are
-- managed from /admin, so the wall updates instantly.
--
-- `src/data/supporters.ts` is kept as the static fallback used when D1 is not
-- available (e.g. local dev before migrations are applied).
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/007_supporters.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS supporters (
  id             TEXT PRIMARY KEY,                  -- UUID v7
  name           TEXT NOT NULL,
  tier           TEXT NOT NULL DEFAULT 'supporter', -- chai|fuel|meal|sponsor|supporter
  tier_label     TEXT,                              -- Optional display override
  message        TEXT,                              -- Optional public note
  avatar_url     TEXT,
  supporter_date TEXT,                              -- Free-form, e.g. '2026-09'
  created_at     INTEGER NOT NULL,                  -- Epoch ms; drives newest-first order
  created_by     TEXT,                              -- Admin user id that added the row
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_supporters_created
  ON supporters (created_at DESC);

-- Seed: backers that previously lived in `src/data/supporters.ts`. Fixed ids +
-- INSERT OR IGNORE make this safe to re-run and safe to apply on a database
-- where the admin already added someone manually.
INSERT OR IGNORE INTO supporters (id, name, tier, tier_label, created_at, created_by)
VALUES
  ('0199a000-0000-7000-8000-000000000001', 'Tanu Tapli',  'supporter', 'Supporter', 1757000000000, NULL),
  ('0199a000-0000-7000-8000-000000000002', 'Rajat Singh', 'supporter', 'Supporter', 1757000001000, NULL),
  ('0199a000-0000-7000-8000-000000000003', 'Chinmay Das', 'supporter', 'Supporter', 1757000002000, NULL);
