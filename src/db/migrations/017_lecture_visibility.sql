-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 017: Lecture Visibility (Hidden / Draft Lectures)
--
-- Adds lecture_settings table to Cloudflare D1.
-- Allows admins to hide individual lectures inside an otherwise public subject.
-- Hidden lectures are completely invisible to non-admins (listings, search,
-- sitemap, bookmarks and direct URLs) but remain previewable by admins.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/017_lecture_visibility.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lecture_settings (
  subject_name   TEXT NOT NULL,                    -- Canonical subject folder name
  lecture_folder TEXT NOT NULL,                    -- Canonical lecture folder name (stable identifier)
  is_public      INTEGER NOT NULL DEFAULT 1,       -- 1 = public to everyone, 0 = hidden (admin preview only)
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT,                             -- Admin user_id who modified it
  PRIMARY KEY (subject_name, lecture_folder)
);

CREATE INDEX IF NOT EXISTS idx_lecture_settings_public
  ON lecture_settings (is_public);

CREATE INDEX IF NOT EXISTS idx_lecture_settings_subject
  ON lecture_settings (subject_name);
