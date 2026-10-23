-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 011: Subject Visibility (Hidden / Draft Subjects)
--
-- Adds subject_settings table to Cloudflare D1.
-- Allows admins to hide a subject and all its lectures completely from
-- non-admin users. Admins can preview the subject and its lecture notes
-- until they choose to make it public.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/011_subject_visibility.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subject_settings (
  subject_name  TEXT PRIMARY KEY,                  -- Canonical subject folder name
  is_public     INTEGER NOT NULL DEFAULT 1,        -- 1 = public to everyone, 0 = hidden (admin preview only)
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT                               -- Admin user_id who modified it
);

CREATE INDEX IF NOT EXISTS idx_subject_settings_public
  ON subject_settings (is_public);
