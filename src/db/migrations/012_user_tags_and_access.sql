-- ═══════════════════════════════════════════════════════════════════════════════
-- 012: User tags and timed access
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/012_user_tags_and_access.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN tags TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE users ADD COLUMN access_expires_at INTEGER DEFAULT 1805155199999; -- 15 March 2027 23:59:59.999 UTC

-- Backfill existing users:
-- If email follows bits-pilani pattern AND starts with '2025', tag as 'batchmate', else 'normal'
UPDATE users
SET tags = 'batchmate'
WHERE (LOWER(email) LIKE '%@bits-pilani.ac.in' OR LOWER(email) LIKE '%.bits-pilani.ac.in')
  AND LOWER(email) LIKE '2025%';

UPDATE users
SET tags = 'normal'
WHERE tags = 'batchmate'
  AND (LOWER(email) NOT LIKE '2025%' OR (LOWER(email) NOT LIKE '%@bits-pilani.ac.in' AND LOWER(email) NOT LIKE '%.bits-pilani.ac.in'));

-- Default access for all existing accounts to 15 March 2027 if unset
UPDATE users
SET access_expires_at = 1805155199999
WHERE access_expires_at IS NULL;
