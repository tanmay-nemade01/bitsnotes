-- ═══════════════════════════════════════════════════════════════════════════════
-- BitsNotes Auth & User Features Schema
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/schema.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Auth: Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,            -- UUID v7
  email           TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,                   -- NULL until verified
  display_name    TEXT,
  avatar_url      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'  -- pending|active|suspended|deleted
);

-- ─── Auth: OAuth Identities ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identities (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,               -- 'google' | 'github'
  provider_uid    TEXT NOT NULL,               -- provider's stable user id
  created_at      INTEGER NOT NULL,
  UNIQUE(provider, provider_uid)
);

-- ─── Auth: Entitlements ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entitlements (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier            TEXT NOT NULL DEFAULT 'free',   -- free|pro|...
  expires_at      INTEGER,                        -- NULL = never expires
  source          TEXT NOT NULL DEFAULT 'manual',  -- manual|stripe|...
  updated_at      INTEGER NOT NULL
);

-- ─── Auth: Email Verification Tokens ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash      TEXT PRIMARY KEY,            -- SHA-256 of token
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         TEXT NOT NULL,               -- 'signup' | 'email_change'
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER,
  created_at      INTEGER NOT NULL
);

-- ─── Auth: Refresh Tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash      TEXT PRIMARY KEY,            -- SHA-256 of opaque token
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  replaced_by     TEXT                         -- token_hash of successor after rotation
);

-- ─── Auth: Audit Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT,
  event           TEXT NOT NULL,               -- signup|login|logout|verify|failed_login|...
  provider        TEXT,
  ip              TEXT,
  ua              TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identities_provider_uid ON identities(provider, provider_uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─── Bookmarks & Collections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collections (
  id              TEXT PRIMARY KEY,            -- UUID v7
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id              TEXT PRIMARY KEY,            -- UUID v7
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  lecture         TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_coll ON bookmarks(user_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

-- ─── Reading Progress ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  lecture         TEXT NOT NULL,
  read_pct        INTEGER NOT NULL DEFAULT 0,  -- 0-100, max scroll ever reached
  last_read_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, subject, lecture)
);

-- ─── Engagement: Comments (Phase 4) ───────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS admin_users (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_created
  ON admin_users (created_at DESC);

-- ─── Engagement: Page Feedback (Phase 5) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS page_feedback (
  id            TEXT PRIMARY KEY,                 -- UUID v7
  page_type     TEXT NOT NULL,                    -- 'lecture' | 'subject'
  subject       TEXT NOT NULL,                    -- Manifest subject name
  lecture       TEXT,                             -- Folder name; NULL for subject page
  visitor_hash  TEXT NOT NULL,                    -- HMAC of functional visitor cookie
  value         INTEGER NOT NULL,                 -- 1 useful / -1 not yet
  reason        TEXT,                             -- Optional, <=300 chars, NOT public in v1
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(page_type, subject, lecture, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_feedback_page
  ON page_feedback (page_type, subject, lecture, value);
CREATE INDEX IF NOT EXISTS idx_feedback_visitor
  ON page_feedback (visitor_hash, page_type, subject, lecture);
