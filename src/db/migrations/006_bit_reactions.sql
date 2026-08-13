-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 006: Bit emoji reactions
-- Signed-in users can toggle a fixed set of emojis on /bits posts.
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/006_bit_reactions.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bit_reactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  emoji         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE(user_id, slug, emoji)
);

CREATE INDEX IF NOT EXISTS idx_bit_reactions_slug ON bit_reactions(slug);
CREATE INDEX IF NOT EXISTS idx_bit_reactions_user ON bit_reactions(user_id);
