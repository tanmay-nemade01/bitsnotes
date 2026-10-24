import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import {
  DEFAULT_ACCESS_EXPIRES_AT,
  isBitsPilaniEmail,
  isBatchmateEmail,
  getUserDefaultTag,
  isUserAccessExpired,
} from '../src/lib/auth/access';
import { createUser, findUserById } from '../src/lib/auth';
import { addAdmin } from '../src/lib/comments';
import { listAdminUsers, findAdminUserById, updateUserAdminSettings } from '../src/lib/users';
import { POST as userAdminPost } from '../src/pages/api/admin/users/[id]';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  method: string;
  url: string;
  params?: Record<string, string>;
  user?: any;
  body?: unknown;
  origin?: string;
}): any {
  const headers = new Headers();
  if (opts.origin) headers.set('Origin', opts.origin);
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json');

  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  return {
    request,
    params: opts.params ?? {},
    locals: { user: opts.user ?? null },
    url: new URL(opts.url),
  };
}

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
  setTestEnv({ DB: db, APP_BASE_URL: BASE });
});

describe('User Tags: BITS Pilani Pattern & 2025 Batchmate Matching', () => {
  it('correctly classifies BITS Pilani domain emails starting with 2025 as batchmate', () => {
    expect(isBitsPilaniEmail('2025hz12345@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBatchmateEmail('2025hz12345@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBatchmateEmail('2025A7PS0001P@pilani.bits-pilani.ac.in')).toBe(true);

    expect(getUserDefaultTag('2025hz12345@wilp.bits-pilani.ac.in')).toBe('batchmate');
    expect(getUserDefaultTag('2025A7PS0001P@pilani.bits-pilani.ac.in')).toBe('batchmate');
  });

  it('classifies BITS emails NOT starting with 2025 as normal', () => {
    expect(isBitsPilaniEmail('f20220001@pilani.bits-pilani.ac.in')).toBe(true);
    expect(isBitsPilaniEmail('student@goa.bits-pilani.ac.in')).toBe(true);
    expect(isBitsPilaniEmail('researcher@hyderabad.bits-pilani.ac.in')).toBe(true);
    expect(isBitsPilaniEmail('faculty@bits-pilani.ac.in')).toBe(true);

    expect(isBatchmateEmail('f20220001@pilani.bits-pilani.ac.in')).toBe(false);
    expect(isBatchmateEmail('student@goa.bits-pilani.ac.in')).toBe(false);
    expect(isBatchmateEmail('faculty@bits-pilani.ac.in')).toBe(false);

    expect(getUserDefaultTag('f20220001@pilani.bits-pilani.ac.in')).toBe('normal');
    expect(getUserDefaultTag('student@goa.bits-pilani.ac.in')).toBe('normal');
    expect(getUserDefaultTag('faculty@bits-pilani.ac.in')).toBe('normal');
  });

  it('correctly classifies non-BITS emails starting with 2025 as normal', () => {
    expect(isBitsPilaniEmail('2025john@gmail.com')).toBe(false);
    expect(isBatchmateEmail('2025john@gmail.com')).toBe(false);
    expect(getUserDefaultTag('2025john@gmail.com')).toBe('normal');
  });

  it('correctly classifies regular non-BITS emails as normal', () => {
    expect(isBitsPilaniEmail('tanmaynemade@gmail.com')).toBe(false);
    expect(isBitsPilaniEmail('student@other-university.edu')).toBe(false);
    expect(isBitsPilaniEmail('fake@bits-pilani.com')).toBe(false);
    expect(isBitsPilaniEmail(null)).toBe(false);
    expect(isBitsPilaniEmail(undefined)).toBe(false);

    expect(getUserDefaultTag('tanmaynemade@gmail.com')).toBe('normal');
    expect(getUserDefaultTag('student@outlook.com')).toBe('normal');
  });
});

describe('User Registration: Default Tags & Timed Access Expiration', () => {
  it('automatically tags BITS user as batchmate and sets default access to 15 March 2027', async () => {
    const user = await createUser(db, {
      email: '2025test@wilp.bits-pilani.ac.in',
      displayName: 'BITS Batchmate',
      avatarUrl: null,
    });

    expect(user.tags).toBe('batchmate');
    expect(user.access_expires_at).toBe(DEFAULT_ACCESS_EXPIRES_AT);
    expect(user.access_expires_at).toBe(1805155199999);

    const saved = await findUserById(db, user.id);
    expect(saved?.tags).toBe('batchmate');
    expect(saved?.access_expires_at).toBe(1805155199999);
  });

  it('automatically tags external user as normal with default access to 15 March 2027', async () => {
    const user = await createUser(db, {
      email: 'regular.person@gmail.com',
      displayName: 'Normal User',
      avatarUrl: null,
    });

    expect(user.tags).toBe('normal');
    expect(user.access_expires_at).toBe(DEFAULT_ACCESS_EXPIRES_AT);

    const saved = await findUserById(db, user.id);
    expect(saved?.tags).toBe('normal');
    expect(saved?.access_expires_at).toBe(1805155199999);
  });
});

describe('Access Expiration Calculation', () => {
  it('calculates access expired correctly based on current time', () => {
    const past = Date.now() - 10000;
    const future = Date.now() + 10000000;

    // Past expiration date → expired
    expect(isUserAccessExpired({ accessExpiresAt: past })).toBe(true);

    // Future expiration date → active
    expect(isUserAccessExpired({ accessExpiresAt: future })).toBe(false);

    // Default 15 March 2027 expiration date → active right now
    expect(isUserAccessExpired({ accessExpiresAt: DEFAULT_ACCESS_EXPIRES_AT })).toBe(false);

    // Indefinite (null) → active
    expect(isUserAccessExpired({ accessExpiresAt: null })).toBe(false);

    // Admin user → NEVER expired even if access date was in the past
    expect(isUserAccessExpired({ accessExpiresAt: past }, true)).toBe(false);
  });
});

describe('Admin Users Management: Querying and Updating Tags & Timed Access', () => {
  it('includes tags and access expiration in listAdminUsers roster', async () => {
    const user1 = await createUser(db, {
      email: '2025student1@wilp.bits-pilani.ac.in',
      displayName: 'Batchmate One',
      avatarUrl: null,
    });
    const user2 = await createUser(db, {
      email: 'outsider@gmail.com',
      displayName: 'Normal One',
      avatarUrl: null,
    });

    const roster = await listAdminUsers(db, {});
    expect(roster.total).toBe(2);

    const row1 = roster.users.find((u) => u.id === user1.id);
    const row2 = roster.users.find((u) => u.id === user2.id);

    expect(row1?.tags).toBe('batchmate');
    expect(row1?.accessExpiresAt).toBe(DEFAULT_ACCESS_EXPIRES_AT);
    expect(row1?.isAccessExpired).toBe(false);

    expect(row2?.tags).toBe('normal');
    expect(row2?.accessExpiresAt).toBe(DEFAULT_ACCESS_EXPIRES_AT);
  });

  it('allows admin to manually update a user access expiration date and tag via API', async () => {
    const adminUser = await createUser(db, {
      email: 'admin@bitsnotes.com',
      displayName: 'Super Admin',
      avatarUrl: null,
    });
    await addAdmin(db, adminUser.id);

    const targetUser = await createUser(db, {
      email: 'target@gmail.com',
      displayName: 'Target User',
      avatarUrl: null,
    });

    // 1. Manually extend access to 2028 and promote tag to batchmate
    const targetExpires = new Date('2028-06-01T23:59:59.999Z').getTime();
    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/admin/users/${targetUser.id}`,
      params: { id: targetUser.id },
      origin: BASE,
      user: { id: adminUser.id, email: adminUser.email, status: 'active' },
      body: {
        accessExpiresAt: targetExpires,
        tags: 'batchmate',
      },
    });

    const res = await userAdminPost(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.tags).toBe('batchmate');
    expect(body.user.accessExpiresAt).toBe(targetExpires);

    // Verify DB reflection
    const updatedView = await findAdminUserById(db, targetUser.id);
    expect(updatedView?.tags).toBe('batchmate');
    expect(updatedView?.accessExpiresAt).toBe(targetExpires);

    // 2. Manually revoke access by setting expiration to a past date
    const pastExpires = Date.now() - 3600000;
    const ctx2 = makeContext({
      method: 'POST',
      url: `${BASE}/api/admin/users/${targetUser.id}`,
      params: { id: targetUser.id },
      origin: BASE,
      user: { id: adminUser.id, email: adminUser.email, status: 'active' },
      body: {
        accessExpiresAt: pastExpires,
      },
    });

    const res2 = await userAdminPost(ctx2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.user.accessExpiresAt).toBe(pastExpires);
    expect(body2.user.isAccessExpired).toBe(true);

    // 3. Clear expiration (indefinite access)
    const ctx3 = makeContext({
      method: 'POST',
      url: `${BASE}/api/admin/users/${targetUser.id}`,
      params: { id: targetUser.id },
      origin: BASE,
      user: { id: adminUser.id, email: adminUser.email, status: 'active' },
      body: {
        accessExpiresAt: null,
      },
    });

    const res3 = await userAdminPost(ctx3);
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3.user.accessExpiresAt).toBeNull();
    expect(body3.user.isAccessExpired).toBe(false);
  });

  it('rejects non-admin or unauthenticated access update requests', async () => {
    const regularUser = await createUser(db, {
      email: 'regular@gmail.com',
      displayName: 'Regular User',
      avatarUrl: null,
    });

    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/admin/users/${regularUser.id}`,
      params: { id: regularUser.id },
      origin: BASE,
      user: { id: regularUser.id, email: regularUser.email, status: 'active' },
      body: { tags: 'batchmate' },
    });

    const res = await userAdminPost(ctx);
    expect(res.status).toBe(403);
  });
});
