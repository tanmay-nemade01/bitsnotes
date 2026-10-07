-- ═══════════════════════════════════════════════════════════════════════════════
-- 008: Backup email (WILP 2025 cohort only; eligibility enforced in app code)
-- Run once: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/008_backup_email.sql --remote
-- (ALTER TABLE is not idempotent, so this is NOT part of schema.sql re-runs.)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN backup_email TEXT;                -- NULL for ineligible users
ALTER TABLE users ADD COLUMN backup_email_verified_at INTEGER; -- NULL until verified

-- Only a VERIFIED backup email must be unique (prevents squatting a pending one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_backup_email_verified
  ON users(backup_email) WHERE backup_email_verified_at IS NOT NULL;
