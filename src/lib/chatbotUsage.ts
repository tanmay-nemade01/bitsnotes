/**
 * Chatbot Usage & Daily Limits Service
 *
 * Implements daily message quota tracking for the BitsNotes AI Assistant.
 * - Standard users have a daily quota (default 20 messages/day, customizable per user).
 * - Admins are completely exempt (unlimited quota).
 * - Resets occur automatically and simultaneously for all users at 00:00:00 UTC
 *   every day via time-partitioned daily period keys (YYYY-MM-DD).
 *
 * The quota is intentionally not exposed to end users. Callers should use this
 * service for internal enforcement only and must not return limit details in
 * public API responses.
 */

import type { AuthDb } from './auth/db';

export const DEFAULT_DAILY_LIMIT = 20;

/**
 * Returns current day key in UTC (YYYY-MM-DD).
 * Because all queries check against this period key, all users automatically and
 * instantaneously roll over to a fresh 0-message count at 00:00 UTC each day
 * with no locking or batch job needed.
 */
export function currentUsageDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export interface ChatbotUsageInfo {
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  isAdmin: boolean;
  day: string;
}

/**
 * Get a user's configured daily limit.
 * If users.chatbot_limit is NULL, returns DEFAULT_DAILY_LIMIT (20).
 */
export async function getUserChatbotLimit(db: AuthDb, userId: string): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT chatbot_limit FROM users WHERE id = ?')
      .bind(userId)
      .first<{ chatbot_limit: number | null }>();

    if (row && row.chatbot_limit !== null && row.chatbot_limit !== undefined) {
      return Math.max(0, Number(row.chatbot_limit));
    }
  } catch {
    // Column may not be migrated yet on older/unmigrated databases
  }
  return DEFAULT_DAILY_LIMIT;
}

/**
 * Fetch daily usage for a user.
 */
export async function getChatbotUsage(
  db: AuthDb,
  userId: string,
  isAdmin: boolean,
  day = currentUsageDay()
): Promise<ChatbotUsageInfo> {
  const row = await db
    .prepare('SELECT message_count FROM chatbot_usage WHERE user_id = ? AND usage_date = ?')
    .bind(userId, day)
    .first<{ message_count: number }>();

  const used = row?.message_count ?? 0;

  if (isAdmin) {
    return {
      used,
      limit: null,
      remaining: null,
      unlimited: true,
      isAdmin: true,
      day,
    };
  }

  const limit = await getUserChatbotLimit(db, userId);
  const remaining = Math.max(0, limit - used);

  return {
    used,
    limit,
    remaining,
    unlimited: false,
    isAdmin: false,
    day,
  };
}

/**
 * Atomically reserve one message from a user's daily quota.
 *
 * Returns `true` when a slot was reserved, `false` when the user is at/over
 * their limit. The conditional UPDATE is the important part: it prevents two
 * concurrent requests from both passing a read-then-write quota check.
 *
 * Callers MUST refund with `refundChatbotUsage` if the request fails.
 */
export async function reserveChatbotUsage(
  db: AuthDb,
  userId: string,
  limit: number,
  day = currentUsageDay()
): Promise<boolean> {
  const safeLimit = Math.max(0, Math.trunc(limit));

  // Ensure the period row exists without consuming anything.
  await db
    .prepare(
      `INSERT OR IGNORE INTO chatbot_usage (user_id, usage_date, message_count)
       VALUES (?, ?, 0)`
    )
    .bind(userId, day)
    .run();

  const result = await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = message_count + 1
       WHERE user_id = ? AND usage_date = ? AND message_count < ?`
    )
    .bind(userId, day, safeLimit)
    .run();

  const changes = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0;
  return changes > 0;
}

/**
 * Return one reserved message to the user's daily quota.
 * Safe to call even if the counter is already at zero.
 */
export async function refundChatbotUsage(
  db: AuthDb,
  userId: string,
  day = currentUsageDay()
): Promise<void> {
  await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END
       WHERE user_id = ? AND usage_date = ?`
    )
    .bind(userId, day)
    .run();
}

/**
 * Return several reserved messages to a user's quota at once (used by the
 * stale-pending cleanup).
 */
export async function refundChatbotUsageBy(
  db: AuthDb,
  userId: string,
  count: number,
  day = currentUsageDay()
): Promise<void> {
  const safeCount = Math.max(0, Math.trunc(count));
  if (safeCount === 0) return;

  await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = CASE WHEN message_count >= ? THEN message_count - ? ELSE 0 END
       WHERE user_id = ? AND usage_date = ?`
    )
    .bind(safeCount, safeCount, userId, day)
    .run();
}

/**
 * Reset a user's usage for the given day (defaults to the current UTC day).
 */
export async function resetUserDailyUsage(
  db: AuthDb,
  userId: string,
  day = currentUsageDay()
): Promise<void> {
  await db
    .prepare('DELETE FROM chatbot_usage WHERE user_id = ? AND usage_date = ?')
    .bind(userId, day)
    .run();
}
