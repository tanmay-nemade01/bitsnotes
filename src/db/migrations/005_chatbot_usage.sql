-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 005: Chatbot Usage Tracking
-- Tracks daily message counts per user for the BitsNotes AI chatbot mode.
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/005_chatbot_usage.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chatbot_usage (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date    TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_usage_date
  ON chatbot_usage (usage_date, user_id);
