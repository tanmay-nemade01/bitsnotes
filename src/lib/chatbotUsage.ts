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
 * Increment monthly usage for a user by 1.
 */
export async function incrementChatbotUsage(
  db: AuthDb,
  userId: string,
  isAdmin: boolean,
  month = currentUsageMonth()
): Promise<ChatbotUsageInfo> {
  await db
    .prepare(
      `INSERT INTO chatbot_usage (user_id, usage_date, message_count)
       VALUES (?, ?, 1)
       ON CONFLICT (user_id, usage_date)
       DO UPDATE SET message_count = message_count + 1`
    )
    .bind(userId, month)
    .run();

  return getChatbotUsage(db, userId, isAdmin, month);
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

