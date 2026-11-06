-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 016: Chatbot Request Tracking & Model Setting
--
-- Splits chatbot telemetry into two tables:
--   1. chatbot_requests  — one row per request lifecycle (pending → success/error)
--   2. chatbot_questions — one row per user question (content only)
--
-- The status table is the audit/quota ledger. A request is inserted as `pending`
-- before the upstream model call and updated in place afterwards, so a request
-- never produces two rows. `reserved` marks requests that consumed a quota slot.
--
-- Chatbot responses are intentionally NOT stored anywhere.
--
-- Also adds a generic key/value `app_settings` table used to persist the
-- admin-selected OpenRouter model.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/016_chatbot_request_tracking.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chatbot_requests (
  request_id        TEXT PRIMARY KEY,                 -- Client-generated UUID (idempotency key)
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   TEXT,                             -- Groups multi-turn questions
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'error')),
  error_code        TEXT,                             -- Sanitized code, never raw upstream text
  http_status       INTEGER,                          -- Status associated with the failure (upstream or local)
  model             TEXT,                             -- Actual OpenRouter model used
  usage_month       TEXT NOT NULL,                    -- YYYY-MM (UTC quota period)
  created_at        INTEGER NOT NULL,                 -- Request start (unix ms)
  finished_at       INTEGER,                          -- Request completion (unix ms)
  latency_ms        INTEGER,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  reserved          INTEGER NOT NULL DEFAULT 0        -- 1 = holds a quota slot
);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_user_month
  ON chatbot_requests (user_id, usage_month, status);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_month_status
  ON chatbot_requests (usage_month, status);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_status_created
  ON chatbot_requests (status, created_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_user_created
  ON chatbot_requests (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_conversation
  ON chatbot_requests (conversation_id);

CREATE INDEX IF NOT EXISTS idx_chatbot_requests_created
  ON chatbot_requests (created_at);

CREATE TABLE IF NOT EXISTS chatbot_questions (
  request_id       TEXT PRIMARY KEY REFERENCES chatbot_requests(request_id) ON DELETE CASCADE,
  conversation_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_text    TEXT NOT NULL,                     -- The user's question only (no response)
  turn_index       INTEGER NOT NULL DEFAULT 0,        -- 0 = first question in conversation
  subject          TEXT,
  lecture_folder   TEXT,
  lecture_title    TEXT,
  lecture_number   INTEGER,
  include_textbook INTEGER NOT NULL DEFAULT 1,
  page_url         TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chatbot_questions_conversation
  ON chatbot_questions (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_questions_subject
  ON chatbot_questions (subject, created_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_questions_user
  ON chatbot_questions (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_questions_created
  ON chatbot_questions (created_at);

-- ─── Generic app settings (admin-managed) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
