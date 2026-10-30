-- ═══════════════════════════════════════════════════════════════════════════════
-- 013: Chatbot Monthly Limit
-- Adds custom monthly chatbot message limit per user to the users table.
-- NULL indicates standard default limit (20 messages/month).
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/013_chatbot_monthly_limits.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN chatbot_limit INTEGER DEFAULT NULL;

-- Aggregate any existing daily counts from the current month into the monthly format (YYYY-MM)
INSERT OR REPLACE INTO chatbot_usage (user_id, usage_date, message_count)
SELECT user_id, SUBSTR(usage_date, 1, 7) AS usage_date, SUM(message_count) AS message_count
FROM chatbot_usage
WHERE LENGTH(usage_date) = 10
GROUP BY user_id, SUBSTR(usage_date, 1, 7);

