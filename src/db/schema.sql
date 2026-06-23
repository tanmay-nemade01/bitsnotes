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
