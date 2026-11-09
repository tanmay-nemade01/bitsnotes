import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  DEFAULT_DAILY_LIMIT,
  currentUsageDay,
  getChatbotUsage,
  refundChatbotUsage,
  reserveChatbotUsage,
  resetUserDailyUsage,
  getUserChatbotLimit,
} from '../src/lib/chatbotUsage';
import { findAdminUserById, updateUserAdminSettings } from '../src/lib/users';

let db: AuthDb;

async function seedUser(id: string, email: string, chatbotLimit: number | null = null): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at, status, chatbot_limit)
       VALUES (?, ?, 'Test User', ?, ?, 'active', ?)`
    )
    .bind(id, email, now, now, chatbotLimit)
    .run();
}

beforeEach(() => {
  db = makeDb();
});

describe('Chatbot Daily Usage & Limits', () => {
  it('formats current day as YYYY-MM-DD in UTC', () => {
    const d = new Date('2026-10-29T12:00:00Z');
    expect(currentUsageDay(d)).toBe('2026-10-29');

    const nextDay = new Date('2026-10-30T00:00:00Z');
    expect(currentUsageDay(nextDay)).toBe('2026-10-30');
  });

  it('provides default daily limit of 20 for regular users with no override', async () => {
    await seedUser('user-1', 'student1@bits-pilani.ac.in');

    const limit = await getUserChatbotLimit(db, 'user-1');
    expect(limit).toBe(DEFAULT_DAILY_LIMIT);
    expect(limit).toBe(20);

    const usage = await getChatbotUsage(db, 'user-1', false, '2026-10-29');
    expect(usage).toEqual({
      used: 0,
      limit: 20,
      remaining: 20,
      unlimited: false,
      isAdmin: false,
      day: '2026-10-29',
    });
  });

  it('reserves daily usage properly and decreases remaining messages', async () => {
    await seedUser('user-2', 'student2@bits-pilani.ac.in');

    expect(await reserveChatbotUsage(db, 'user-2', 20, '2026-10-29')).toBe(true);
    let usage = await getChatbotUsage(db, 'user-2', false, '2026-10-29');
    expect(usage.used).toBe(1);
    expect(usage.remaining).toBe(19);

    expect(await reserveChatbotUsage(db, 'user-2', 20, '2026-10-29')).toBe(true);
    usage = await getChatbotUsage(db, 'user-2', false, '2026-10-29');
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(18);
  });

  it('refuses to reserve past the daily limit', async () => {
    await seedUser('user-limit', 'limit@bitsnotes.com', 2);

    expect(await reserveChatbotUsage(db, 'user-limit', 2, '2026-10-29')).toBe(true);
    expect(await reserveChatbotUsage(db, 'user-limit', 2, '2026-10-29')).toBe(true);
    expect(await reserveChatbotUsage(db, 'user-limit', 2, '2026-10-29')).toBe(false);

    const usage = await getChatbotUsage(db, 'user-limit', false, '2026-10-29');
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(0);
  });

  it('refunds a reserved message on failure', async () => {
    await seedUser('user-refund', 'refund@bitsnotes.com', 20);

    expect(await reserveChatbotUsage(db, 'user-refund', 20, '2026-10-29')).toBe(true);
    let usage = await getChatbotUsage(db, 'user-refund', false, '2026-10-29');
    expect(usage.used).toBe(1);

    await refundChatbotUsage(db, 'user-refund', '2026-10-29');
    usage = await getChatbotUsage(db, 'user-refund', false, '2026-10-29');
    expect(usage.used).toBe(0);
    expect(usage.remaining).toBe(20);
  });

  it('exempts admin users completely (unlimited messages)', async () => {
    await seedUser('admin-1', 'admin@bitsnotes.com');

    const usage = await getChatbotUsage(db, 'admin-1', true, '2026-10-29');
    expect(usage.unlimited).toBe(true);
    expect(usage.limit).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.isAdmin).toBe(true);
  });

  it('honors individual user limits configured by admin', async () => {
    await seedUser('user-custom', 'custom@bitsnotes.com', 50);

    const limit = await getUserChatbotLimit(db, 'user-custom');
    expect(limit).toBe(50);

    const usage = await getChatbotUsage(db, 'user-custom', false, '2026-10-29');
    expect(usage.limit).toBe(50);
    expect(usage.remaining).toBe(50);
  });

  it('handles disabling chatbot access when limit is set to 0', async () => {
    await seedUser('user-disabled', 'disabled@bitsnotes.com', 0);

    const usage = await getChatbotUsage(db, 'user-disabled', false, '2026-10-29');
    expect(usage.limit).toBe(0);
    expect(usage.remaining).toBe(0);
  });

  it('resets usage for the current day on demand', async () => {
    await seedUser('user-reset', 'reset@bitsnotes.com');

    await reserveChatbotUsage(db, 'user-reset', 20, '2026-10-29');
    await reserveChatbotUsage(db, 'user-reset', 20, '2026-10-29');
    let usage = await getChatbotUsage(db, 'user-reset', false, '2026-10-29');
    expect(usage.used).toBe(2);

    await resetUserDailyUsage(db, 'user-reset', '2026-10-29');
    usage = await getChatbotUsage(db, 'user-reset', false, '2026-10-29');
    expect(usage.used).toBe(0);
    expect(usage.remaining).toBe(20);
  });

  it('automatically rolls over at the UTC day boundary with zero manual intervention', async () => {
    await seedUser('user-rollover', 'rollover@bitsnotes.com');

    // Use 15 messages on 29 October
    for (let i = 0; i < 15; i++) {
      await reserveChatbotUsage(db, 'user-rollover', 20, '2026-10-29');
    }
    const octUsage = await getChatbotUsage(db, 'user-rollover', false, '2026-10-29');
    expect(octUsage.used).toBe(15);
    expect(octUsage.remaining).toBe(5);

    // On 30 October, the user automatically starts with 0 used and 20 remaining!
    const nextDayUsage = await getChatbotUsage(db, 'user-rollover', false, '2026-10-30');
    expect(nextDayUsage.used).toBe(0);
    expect(nextDayUsage.remaining).toBe(20);

    // Previous day's historical usage is preserved
    const priorDayRecheck = await getChatbotUsage(db, 'user-rollover', false, '2026-10-29');
    expect(priorDayRecheck.used).toBe(15);
  });

  it('allows updating user chatbotLimit via updateUserAdminSettings', async () => {
    await seedUser('user-admin-update', 'student@bits-pilani.ac.in');

    let userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBeNull();

    // Admin updates limit to 75
    await updateUserAdminSettings(db, 'user-admin-update', { chatbotLimit: 75 });
    userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBe(75);

    const usage = await getChatbotUsage(db, 'user-admin-update', false, '2026-10-29');
    expect(usage.limit).toBe(75);

    // Revert back to default (null)
    await updateUserAdminSettings(db, 'user-admin-update', { chatbotLimit: null });
    userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBeNull();
  });
});
