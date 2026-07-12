/**
 * Test-only schema for the engagement tables (comments, feedback, admin).
 *
 * This mirrors `src/db/schema.sql` but uses SQLite-compatible syntax so it
 * can run against better-sqlite3 in-memory. The production schema is the
 * source of truth; this file must be kept in sync with the engagement
 * section of `src/db/schema.sql`.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,
  display_name    TEXT,
  avatar_url      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id         TEXT PRIMARY KEY,
  tier            TEXT NOT NULL DEFAULT 'free',
  expires_at      INTEGER,
  source          TEXT NOT NULL DEFAULT 'manual',
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  user_id     TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id                TEXT PRIMARY KEY,
  page_type         TEXT NOT NULL,
  subject           TEXT NOT NULL,
  lecture           TEXT,
  display_name      TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'published',
  moderation_reason TEXT,
  author_token_hash TEXT NOT NULL,
  report_count      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_comments_page
  ON comments (page_type, subject, lecture, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_status
  ON comments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS comment_reports (
  id            TEXT PRIMARY KEY,
  comment_id    TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE(comment_id, reporter_hash)
);

CREATE INDEX IF NOT EXISTS idx_comment_reports_comment
  ON comment_reports (comment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS page_feedback (
  id            TEXT PRIMARY KEY,
  page_type     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  lecture       TEXT,
  visitor_hash  TEXT NOT NULL,
  value         INTEGER NOT NULL,
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(page_type, subject, lecture, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_feedback_page
  ON page_feedback (page_type, subject, lecture, value);
CREATE INDEX IF NOT EXISTS idx_feedback_visitor
  ON page_feedback (visitor_hash, page_type, subject, lecture);
`;
