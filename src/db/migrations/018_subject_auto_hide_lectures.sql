-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 018: Auto-hide new lectures per subject
--
-- Adds hide_new_lectures to subject_settings. When enabled for a subject,
-- any lecture without an explicit lecture_settings row is treated as hidden.
-- Enabling the setting snapshots existing lectures as explicitly public so
-- "new" means lectures that appear in the catalog afterwards.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/018_subject_auto_hide_lectures.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE subject_settings ADD COLUMN hide_new_lectures INTEGER NOT NULL DEFAULT 0;
