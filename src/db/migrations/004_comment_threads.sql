-- ═══════════════════════════════════════════════════════════════════════════════
-- BitsNotes Engagement Schema (Phase 6: Reddit-style threaded comments)
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/004_comment_threads.sql --remote
--      wrangler d1 execute bitsnotes_auth --file=src/db/migrations/004_comment_threads.sql --local
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add threading + author-tracking columns to the existing comments table.
-- All additions are nullable / defaulted so existing rows are preserved.
ALTER TABLE comments ADD COLUMN parent_id         TEXT;
ALTER TABLE comments ADD COLUMN depth             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN author_user_id    TEXT;
ALTER TABLE comments ADD COLUMN author_email_hash TEXT;
ALTER TABLE comments ADD COLUMN score             INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_id, created_at ASC);

-- Reddit-style up/down votes.
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
