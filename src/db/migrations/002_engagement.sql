-- ═══════════════════════════════════════════════════════════════════
-- BitsNotes Engagement Schema (Phase 4: Anonymous comments)
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/002_engagement.sql --remote
-- ═══════════════════════════════════════════════════════════════════

-- ─── Comments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id                TEXT PRIMARY KEY,                 -- UUID v7
  page_type         TEXT NOT NULL,                    -- 'lecture' | 'subject'
  subject           TEXT NOT NULL,                    -- Manifest subject name
  lecture           TEXT,                             -- Folder name; NULL for subject page
  display_name      TEXT NOT NULL,                    -- 2–40 chars
  body              TEXT NOT NULL,                    -- Plain text
  status            TEXT NOT NULL DEFAULT 'published', -- published|pending|hidden|deleted
  moderation_reason TEXT,                             -- Optional
  author_token_hash TEXT NOT NULL,                    -- SHA-256 of delete token
  report_count      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_comments_page
  ON comments (page_type, subject, lecture, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_status
  ON comments (status, created_at DESC);

-- ─── Comment Reports ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_reports (
  id            TEXT PRIMARY KEY,                     -- UUID v7
  comment_id    TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,                        -- Hashed visitor identifier
  reason        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE(comment_id, reporter_hash)
);

CREATE INDEX IF NOT EXISTS idx_comment_reports_comment
  ON comment_reports (comment_id, created_at DESC);

-- ─── Admin Users (moderation allowlist) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_created
  ON admin_users (created_at DESC);
