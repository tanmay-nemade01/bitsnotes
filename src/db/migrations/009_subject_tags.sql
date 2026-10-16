-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 009: Dynamic Subject Tags & Section Organization
--
-- Replaces static JSON/file-based semester organization with dynamic, admin-controlled
-- tags stored in D1. Allows admin to create custom tags, rank tag sections on the
-- homepage from top to bottom, attach multiple tags per subject folder (e.g. Featured
-- and Semester 1), and rank subjects within sections on the fly.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/009_subject_tags.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tags (
  id            TEXT PRIMARY KEY,                  -- UUID v7
  name          TEXT NOT NULL UNIQUE,              -- Display name (e.g. 'Featured', 'Semester 2')
  slug          TEXT NOT NULL UNIQUE,              -- Slug for URL anchors / keys (e.g. 'featured')
  description   TEXT,                              -- Subtitle/description shown under section header
  color         TEXT NOT NULL DEFAULT 'accent',    -- Badge color theme: accent, amber, emerald, blue, purple, rose, cyan
  display_order INTEGER NOT NULL DEFAULT 0,        -- Homepage section order (lower = higher up)
  is_visible    INTEGER NOT NULL DEFAULT 1,        -- 1 = shown on homepage, 0 = hidden/draft
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_order
  ON tags (display_order ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS subject_tags (
  id            TEXT PRIMARY KEY,                  -- UUID v7
  subject_name  TEXT NOT NULL,                     -- Canonical subject/folder name
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,        -- Subject ordering within this tag section
  created_at    INTEGER NOT NULL,
  UNIQUE(subject_name, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_tags_tag
  ON subject_tags (tag_id, display_order ASC);

CREATE INDEX IF NOT EXISTS idx_subject_tags_subject
  ON subject_tags (subject_name);

-- Default Seed: Seed initial tags (Featured at order 0, Semester 2 at 1, Semester 1 at 2, Basics at 3)
INSERT OR IGNORE INTO tags (id, name, slug, description, color, display_order, is_visible, created_at, updated_at)
VALUES
  ('0199c000-0000-7000-8000-000000000001', 'Featured', 'featured', 'Core recommended subjects and flagship lecture notes.', 'amber', 0, 1, 1757000000000, 1757000000000),
  ('0199c000-0000-7000-8000-000000000002', 'Semester 2', 'semester-2', 'Second semester postgraduate AI & ML modules.', 'emerald', 1, 1, 1757000001000, 1757000001000),
  ('0199c000-0000-7000-8000-000000000003', 'Semester 1', 'semester-1', 'First semester foundational courses and prerequisites.', 'blue', 2, 1, 1757000002000, 1757000002000),
  ('0199c000-0000-7000-8000-000000000004', 'Basics', 'basics', 'Introductory and refresher materials.', 'purple', 3, 1, 1757000003000, 1757000003000);
