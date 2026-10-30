import { describe, it, expect, beforeEach } from 'vitest';

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { GET as usersGet } from '../src/pages/api/admin/users/index';
import { addAdmin } from '../src/lib/comments';
import { getUserStats, listAdminUsers } from '../src/lib/users';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: { method: string; url: string; user?: any }): any {
  const request = new Request(opts.url, { method: opts.method, headers: new Headers() });
  return {
    request,
    params: {},
    locals: { user: opts.user ?? null },
    url: new URL(opts.url),
  };
}

let db: AuthDb;

const DAY = 24 * 60 * 60 * 1000;
/** Anchored to "now" so the rolling-window stats are deterministic. */
const NOW = Date.now();

interface SeedOpts {
  id: string;
  email: string;
  displayName?: string | null;
  status?: string;
  createdAt: number;
  tier?: string;
  isAdmin?: boolean;
  provider?: string;
  lastLoginAt?: number | null;
}

async function seedUser(opts: SeedOpts): Promise<void> {
  const status = opts.status ?? 'active';
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, email_verified_at, created_at, updated_at, status)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .bind(
      opts.id,
      opts.email,
      opts.displayName ?? null,
      status === 'active' ? opts.createdAt : null,
      opts.createdAt,
      opts.createdAt,
      status,
    )
    .run();

  if (opts.tier) {
    await db
      .prepare("INSERT INTO entitlements (user_id, tier, source, updated_at) VALUES (?, ?, 'manual', ?)")
      .bind(opts.id, opts.tier, opts.createdAt)
      .run();
  }

  if (opts.isAdmin) {
    await db
      .prepare('INSERT INTO admin_users (user_id, created_at) VALUES (?, ?)')
      .bind(opts.id, opts.createdAt)
      .run();
  }

  if (opts.provider) {
    await db
      .prepare(
        'INSERT INTO identities (id, user_id, provider, provider_uid, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(`id-${opts.id}`, opts.id, opts.provider, `uid-${opts.id}`, opts.createdAt)
      .run();
  }

  if (opts.lastLoginAt) {
    await db
      .prepare(
        'INSERT INTO auth_events (user_id, event, provider, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(opts.id, 'login', 'google', '127.0.0.1', 'vitest', opts.lastLoginAt)
      .run();
  }
}

beforeEach(() => {
  db = makeDb();
  setTestEnv({ DB: db, APP_BASE_URL: BASE });
});

describe('GET /api/admin/users', () => {
  it('rejects anonymous (401)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users' });
    const res = await usersGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin user (403)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users', user: { id: 'u-nope' } });
    const res = await usersGet(ctx as any);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown status filter (400)', async () => {
    await addAdmin(db, 'u-admin');
    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/admin/users?status=bogus',
      user: { id: 'u-admin' },
    });
    const res = await usersGet(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns the roster sorted newest first', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u-old', email: 'old@example.com', createdAt: NOW - 10 * DAY });
    await seedUser({ id: 'u-new', email: 'new@example.com', createdAt: NOW - 1 * DAY });
    await seedUser({ id: 'u-mid', email: 'mid@example.com', createdAt: NOW - 5 * DAY });

    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users', user: { id: 'u-admin' } });
    const res = await usersGet(ctx as any);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.users.map((u: any) => u.id)).toEqual(['u-new', 'u-mid', 'u-old']);
  });

  it('returns useful account details for each user', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({
      id: 'u1',
      email: 'reader@example.com',
      displayName: 'Reader One',
      createdAt: NOW - 2 * DAY,
      tier: 'pro',
      isAdmin: true,
      provider: 'google',
      lastLoginAt: NOW - 1 * DAY,
    });

    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users', user: { id: 'u-admin' } });
    const res = await usersGet(ctx as any);
    const data = await res.json();

    const user = data.users.find((u: any) => u.id === 'u1');
    expect(user).toBeDefined();
    expect(user.email).toBe('reader@example.com');
    expect(user.displayName).toBe('Reader One');
    expect(user.status).toBe('active');
    expect(user.emailVerified).toBe(true);
    expect(user.tier).toBe('pro');
    expect(user.isAdmin).toBe(true);
    expect(user.providers).toEqual(['google']);
    expect(user.createdAt).toBe(NOW - 2 * DAY);
    expect(user.lastLoginAt).toBe(NOW - 1 * DAY);
  });

  it('defaults the tier to free and reports a null last sign-in', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'newbie@example.com', createdAt: NOW });

    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users', user: { id: 'u-admin' } });
    const res = await usersGet(ctx as any);
    const data = await res.json();

    const user = data.users.find((u: any) => u.id === 'u1');
    expect(user.tier).toBe('free');
    expect(user.isAdmin).toBe(false);
    expect(user.providers).toEqual([]);
    expect(user.lastLoginAt).toBeNull();
  });

  it('filters by search term across email and display name', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'alice@example.com', displayName: 'Alice', createdAt: NOW });
    await seedUser({ id: 'u2', email: 'bob@example.com', displayName: 'Bob', createdAt: NOW - DAY });

    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/admin/users?search=alice',
      user: { id: 'u-admin' },
    });
    const res = await usersGet(ctx as any);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.users[0].id).toBe('u1');
  });

  it('filters by account status', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'a@example.com', status: 'active', createdAt: NOW });
    await seedUser({ id: 'u2', email: 'b@example.com', status: 'pending', createdAt: NOW - DAY });
    await seedUser({ id: 'u3', email: 'c@example.com', status: 'suspended', createdAt: NOW - 2 * DAY });

    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/admin/users?status=pending',
      user: { id: 'u-admin' },
    });
    const res = await usersGet(ctx as any);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.users[0].id).toBe('u2');
  });

  it('paginates without losing the total count', async () => {
    await addAdmin(db, 'u-admin');
    for (let i = 0; i < 5; i++) {
      await seedUser({ id: `u${i}`, email: `u${i}@example.com`, createdAt: NOW - i * DAY });
    }

    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/admin/users?limit=2&offset=2',
      user: { id: 'u-admin' },
    });
    const res = await usersGet(ctx as any);
    const data = await res.json();
    expect(data.total).toBe(5);
    expect(data.users).toHaveLength(2);
    expect(data.users.map((u: any) => u.id)).toEqual(['u2', 'u3']);
  });

  it('sorts oldest first when requested', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u-old', email: 'old@example.com', createdAt: NOW - 10 * DAY });
    await seedUser({ id: 'u-new', email: 'new@example.com', createdAt: NOW - DAY });

    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/admin/users?order=asc',
      user: { id: 'u-admin' },
    });
    const res = await usersGet(ctx as any);
    const data = await res.json();
    expect(data.users.map((u: any) => u.id)).toEqual(['u-old', 'u-new']);
  });

  it('returns headline stats', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'a@example.com', status: 'active', createdAt: NOW - DAY });
    await seedUser({ id: 'u2', email: 'b@example.com', status: 'pending', createdAt: NOW - 2 * DAY });
    await seedUser({ id: 'u3', email: 'c@example.com', status: 'active', createdAt: NOW - 40 * DAY });

    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/users', user: { id: 'u-admin' } });
    const res = await usersGet(ctx as any);
    const data = await res.json();

    expect(data.stats.total).toBe(3);
    expect(data.stats.active).toBe(2);
    expect(data.stats.pending).toBe(1);
    expect(data.stats.newLast7Days).toBe(2);
    expect(data.stats.newLast30Days).toBe(2);
  });
});

describe('listAdminUsers', () => {
  it('treats LIKE wildcards in the search term as literals', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'a@example.com', createdAt: NOW });
    await seedUser({ id: 'u2', email: 'b@example.com', createdAt: NOW - DAY });

    const result = await listAdminUsers(db, { search: '%' });
    expect(result.total).toBe(0);
  });

  it('handles empty query parameters without errors', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'a@example.com', createdAt: NOW });
    const result = await listAdminUsers(db, {});
    expect(result.total).toBe(1);
    expect(result.users).toHaveLength(1);
  });
});

describe('getUserStats', () => {
  it('counts admins and paid tiers', async () => {
    await addAdmin(db, 'u-admin');
    await seedUser({ id: 'u1', email: 'a@example.com', createdAt: NOW, tier: 'pro' });
    await seedUser({ id: 'u2', email: 'b@example.com', createdAt: NOW - DAY });

    const stats = await getUserStats(db);
    expect(stats.total).toBe(2);
    expect(stats.paid).toBe(1);
    expect(stats.admins).toBe(1);
  });
});
