-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 015: Supporter Lectures Contributed
--
-- Adds a field tracking how many lectures a supporter has contributed notes for.
-- Defaults to 0 for backers who haven't contributed lecture notes.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/015_supporter_lectures_contributed.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE supporters ADD COLUMN lectures_contributed INTEGER DEFAULT 0;

