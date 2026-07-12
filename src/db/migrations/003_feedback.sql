-- ═══════════════════════════════════════════════════════════════════════════════
-- BitsNotes Engagement Schema (Phase 5: "Was this useful?" feedback)
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/003_feedback.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Page Feedback ─────────────────────────────────────────────────────────
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
