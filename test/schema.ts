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

CREATE TABLE IF NOT EXISTS identities (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  provider_uid    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  replaced_by     TEXT
);

CREATE TABLE IF NOT EXISTS auth_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT,
  event           TEXT NOT NULL,
  provider        TEXT,
  ip              TEXT,
  ua              TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identities_provider_uid ON identities(provider, provider_uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS admin_users (
  user_id     TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id                TEXT PRIMARY KEY,
  page_type         TEXT NOT NULL,
  subject           TEXT NOT NULL,
  lecture           TEXT,
  parent_id         TEXT,
  depth             INTEGER NOT NULL DEFAULT 0,
  display_name      TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'published',
  moderation_reason TEXT,
  author_token_hash TEXT NOT NULL,
  author_user_id    TEXT,
  author_email_hash TEXT,
  score             INTEGER NOT NULL DEFAULT 0,
  report_count      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_comments_page
  ON comments (page_type, subject, lecture, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_status
  ON comments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_id, created_at ASC);

CREATE TABLE IF NOT EXISTS comment_votes (
  id            TEXT PRIMARY KEY,
  comment_id    TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  voter_hash    TEXT NOT NULL,
  value         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE(comment_id, voter_hash)
);

CREATE INDEX IF NOT EXISTS idx_comment_votes_comment
  ON comment_votes (comment_id, created_at DESC);

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
