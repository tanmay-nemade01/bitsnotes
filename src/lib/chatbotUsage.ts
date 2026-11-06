/**
 * Chatbot Usage & Monthly Limits Service
 *
 * Implements monthly message quota tracking for the BitsNotes AI Assistant.
 * - Standard users have a monthly quota (default 20 messages/month, customizable per user).
 * - Admins are completely exempt (unlimited quota).
 * - Resets occur automatically and simultaneously for all users at 00:00:00 UTC on the 1st
 *   of every month via time-partitioned monthly period keys (YYYY-MM).
 */

import type { AuthDb } from './auth/db';

export const DEFAULT_MONTHLY_LIMIT = 20;

/**
 * Returns current month key in UTC (YYYY-MM).
 * Because all queries check against this period key, all users automatically and
 * instantaneously roll over to a fresh 0-message count at the start of each month
 * with no locking or batch job needed.
 */
export function currentUsageMonth(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7); // 'YYYY-MM'
}

export interface ChatbotUsageInfo {
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  isAdmin: boolean;
  month: string;
}

/**
 * Get a user's configured monthly limit.
 * If users.chatbot_limit is NULL, returns DEFAULT_MONTHLY_LIMIT (20).
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
  return DEFAULT_MONTHLY_LIMIT;
}

/**
 * Fetch monthly usage for a user.
 */
export async function getChatbotUsage(
  db: AuthDb,
  userId: string,
  isAdmin: boolean,
  month = currentUsageMonth()
): Promise<ChatbotUsageInfo> {
  const row = await db
    .prepare('SELECT message_count FROM chatbot_usage WHERE user_id = ? AND usage_date = ?')
    .bind(userId, month)
    .first<{ message_count: number }>();

  const used = row?.message_count ?? 0;

  if (isAdmin) {
    return {
      used,
      limit: null,
      remaining: null,
      unlimited: true,
      isAdmin: true,
      month,
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
    month,
  };
}

/**
 * Atomically reserve one message from a user's monthly quota.
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
  month = currentUsageMonth()
): Promise<boolean> {
  const safeLimit = Math.max(0, Math.trunc(limit));

  // Ensure the period row exists without consuming anything.
  await db
    .prepare(
      `INSERT OR IGNORE INTO chatbot_usage (user_id, usage_date, message_count)
       VALUES (?, ?, 0)`
    )
    .bind(userId, month)
    .run();

  const result = await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = message_count + 1
       WHERE user_id = ? AND usage_date = ? AND message_count < ?`
    )
    .bind(userId, month, safeLimit)
    .run();

  const changes = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0;
  return changes > 0;
}

/**
 * Return one reserved message to the user's monthly quota.
 * Safe to call even if the counter is already at zero.
 */
export async function refundChatbotUsage(
  db: AuthDb,
  userId: string,
  month = currentUsageMonth()
): Promise<void> {
  await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = CASE WHEN message_count > 0 THEN message_count - 1 ELSE 0 END
       WHERE user_id = ? AND usage_date = ?`
    )
    .bind(userId, month)
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
  month = currentUsageMonth()
): Promise<void> {
  const safeCount = Math.max(0, Math.trunc(count));
  if (safeCount === 0) return;

  await db
    .prepare(
      `UPDATE chatbot_usage
       SET message_count = CASE WHEN message_count >= ? THEN message_count - ? ELSE 0 END
       WHERE user_id = ? AND usage_date = ?`
    )
    .bind(safeCount, safeCount, userId, month)
    .run();
}

/**
 * Reset a user's usage for the given month (defaults to current month).
 */
export async function resetUserMonthlyUsage(
  db: AuthDb,
  userId: string,
  month = currentUsageMonth()
): Promise<void> {
  await db
    .prepare('DELETE FROM chatbot_usage WHERE user_id = ? AND usage_date = ?')
    .bind(userId, month)
    .run();
}

