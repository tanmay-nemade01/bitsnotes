import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  DEFAULT_MONTHLY_LIMIT,
  currentUsageMonth,
  getChatbotUsage,
  incrementChatbotUsage,
  resetUserMonthlyUsage,
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

describe('Chatbot Monthly Usage & Limits', () => {
  it('formats current month as YYYY-MM', () => {
    const d = new Date('2026-10-29T12:00:00Z');
    expect(currentUsageMonth(d)).toBe('2026-10');

    const nextMonth = new Date('2026-11-01T00:00:00Z');
    expect(currentUsageMonth(nextMonth)).toBe('2026-11');
  });

  it('provides default monthly limit of 20 for regular users with no override', async () => {
    await seedUser('user-1', 'student1@bits-pilani.ac.in');

    const limit = await getUserChatbotLimit(db, 'user-1');
    expect(limit).toBe(DEFAULT_MONTHLY_LIMIT);
    expect(limit).toBe(20);

    const usage = await getChatbotUsage(db, 'user-1', false, '2026-10');
    expect(usage).toEqual({
      used: 0,
      limit: 20,
      remaining: 20,
      unlimited: false,
      isAdmin: false,
      month: '2026-10',
    });
  });

  it('increments monthly usage properly and decreases remaining messages', async () => {
    await seedUser('user-2', 'student2@bits-pilani.ac.in');

    const u1 = await incrementChatbotUsage(db, 'user-2', false, '2026-10');
    expect(u1.used).toBe(1);
    expect(u1.remaining).toBe(19);

    const u2 = await incrementChatbotUsage(db, 'user-2', false, '2026-10');
    expect(u2.used).toBe(2);
    expect(u2.remaining).toBe(18);
  });

  it('exempts admin users completely (unlimited messages)', async () => {
    await seedUser('admin-1', 'admin@bitsnotes.com');

    const usage = await getChatbotUsage(db, 'admin-1', true, '2026-10');
    expect(usage.unlimited).toBe(true);
    expect(usage.limit).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.isAdmin).toBe(true);

    const afterIncrement = await incrementChatbotUsage(db, 'admin-1', true, '2026-10');
    expect(afterIncrement.used).toBe(1);
    expect(afterIncrement.unlimited).toBe(true);
    expect(afterIncrement.remaining).toBeNull();
  });

  it('honors individual user limits configured by admin', async () => {
    await seedUser('user-custom', 'custom@bitsnotes.com', 50);

    const limit = await getUserChatbotLimit(db, 'user-custom');
    expect(limit).toBe(50);

    const usage = await getChatbotUsage(db, 'user-custom', false, '2026-10');
    expect(usage.limit).toBe(50);
    expect(usage.remaining).toBe(50);
  });

  it('handles disabling chatbot access when limit is set to 0', async () => {
    await seedUser('user-disabled', 'disabled@bitsnotes.com', 0);

    const usage = await getChatbotUsage(db, 'user-disabled', false, '2026-10');
    expect(usage.limit).toBe(0);
    expect(usage.remaining).toBe(0);
  });

  it('resets usage for current month on demand', async () => {
    await seedUser('user-reset', 'reset@bitsnotes.com');

    await incrementChatbotUsage(db, 'user-reset', false, '2026-10');
    await incrementChatbotUsage(db, 'user-reset', false, '2026-10');
    let usage = await getChatbotUsage(db, 'user-reset', false, '2026-10');
    expect(usage.used).toBe(2);

    await resetUserMonthlyUsage(db, 'user-reset', '2026-10');
    usage = await getChatbotUsage(db, 'user-reset', false, '2026-10');
    expect(usage.used).toBe(0);
    expect(usage.remaining).toBe(20);
  });

  it('automatically rolls over at the month boundary with zero manual intervention', async () => {
    await seedUser('user-rollover', 'rollover@bitsnotes.com');

    // Use 15 messages in October
    for (let i = 0; i < 15; i++) {
      await incrementChatbotUsage(db, 'user-rollover', false, '2026-10');
    }
    const octUsage = await getChatbotUsage(db, 'user-rollover', false, '2026-10');
    expect(octUsage.used).toBe(15);
    expect(octUsage.remaining).toBe(5);

    // In November, the user automatically starts with 0 used and 20 remaining!
    const novUsage = await getChatbotUsage(db, 'user-rollover', false, '2026-11');
    expect(novUsage.used).toBe(0);
    expect(novUsage.remaining).toBe(20);

    // October historical usage is preserved
    const octRecheck = await getChatbotUsage(db, 'user-rollover', false, '2026-10');
    expect(octRecheck.used).toBe(15);
  });

  it('allows updating user chatbotLimit via updateUserAdminSettings', async () => {
    await seedUser('user-admin-update', 'student@bits-pilani.ac.in');

    let userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBeNull();

    // Admin updates limit to 75
    await updateUserAdminSettings(db, 'user-admin-update', { chatbotLimit: 75 });
    userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBe(75);

    const usage = await getChatbotUsage(db, 'user-admin-update', false, '2026-10');
    expect(usage.limit).toBe(75);

    // Revert back to default (null)
    await updateUserAdminSettings(db, 'user-admin-update', { chatbotLimit: null });
    userView = await findAdminUserById(db, 'user-admin-update');
    expect(userView?.chatbotLimit).toBeNull();
  });
});

