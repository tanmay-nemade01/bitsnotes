import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGoogleProfile = {
  provider: 'google',
  providerUid: 'google-uid-default',
  email: 'test@example.com',
  emailVerified: true,
  displayName: 'Test User',
  avatarUrl: null,
};

vi.mock('../src/lib/auth/oauth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/auth/oauth')>();
  return {
    ...original,
    googleExchangeCode: vi.fn(async () => ({ ...mockGoogleProfile })),
    githubExchangeCode: vi.fn(async () => ({
      provider: 'github',
      providerUid: 'github-uid-default',
      email: 'git@example.com',
      emailVerified: true,
      displayName: 'Github User',
      avatarUrl: null,
    })),
  };
});

vi.mock('../src/lib/auth/email', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import {
  isBackupEmailEligible,
} from '../src/lib/auth/backupEmail';
import {
  createUser,
  verifyUserEmail,
  findUserById,
  findUserByBackupEmail,
  setBackupEmail,
  findIdentity,
  createIdentity,
  encodeOAuthState,
} from '../src/lib/auth';
import { verifyJwt } from '../src/lib/auth/session';
import { GET as backupEmailGet, POST as backupEmailPost, DELETE as backupEmailDelete } from '../src/pages/api/auth/backup-email';
import { GET as callbackGet } from '../src/pages/api/auth/callback/[provider]';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-session-signing-key-12345';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  cookie?: string;
  headers?: Record<string, string>;
  user?: any;
}): any {
  const headers = new Headers(opts.headers ?? {});
  if (opts.origin) headers.set('Origin', opts.origin);
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    params: {},
    locals: { user: opts.user ?? null },
    url: new URL(opts.url),
  };
}

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
  setTestEnv({
    DB: db,
    APP_BASE_URL: BASE,
    SESSION_SIGNING_KEY: SECRET,
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
  });
});

describe('Backup Email Eligibility', () => {
  it('correctly matches eligible WILP 2025 cohort emails', () => {
    expect(isBackupEmailEligible('2025hz12345@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBackupEmailEligible('2025h1030001p@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBackupEmailEligible('2025something@WILP.BITS-PILANI.AC.IN')).toBe(true);
  });

  it('rejects ineligible emails', () => {
    expect(isBackupEmailEligible('2024hz12345@wilp.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('2026hz12345@wilp.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('2025h1030001p@pilani.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('2025h1030001p@goa.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('student@gmail.com')).toBe(false);
    expect(isBackupEmailEligible(null)).toBe(false);
    expect(isBackupEmailEligible(undefined)).toBe(false);
    expect(isBackupEmailEligible('')).toBe(false);
  });
});

describe('Database: One-Time Backup Email Setting', () => {
  it('allows setting backup email once and prevents overwriting', async () => {
    const user = await createUser(db, {
      email: '2025wilp@wilp.bits-pilani.ac.in',
      displayName: 'WILP Student',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user.id);

    const firstSet = await setBackupEmail(db, user.id, 'backup1@gmail.com');
    expect(firstSet).toBe(true);

    const rowAfterFirst = await findUserById(db, user.id);
    expect(rowAfterFirst?.backup_email).toBe('backup1@gmail.com');
    expect(rowAfterFirst?.backup_email_verified_at).toBeGreaterThan(0);

    const secondSet = await setBackupEmail(db, user.id, 'backup2@gmail.com');
    expect(secondSet).toBe(false);

    const rowAfterSecond = await findUserById(db, user.id);
    expect(rowAfterSecond?.backup_email).toBe('backup1@gmail.com');
  });

  it('prevents two users from having the same verified backup email', async () => {
    const user1 = await createUser(db, {
      email: '2025user1@wilp.bits-pilani.ac.in',
      displayName: 'User One',
      avatarUrl: null,
    });
    const user2 = await createUser(db, {
      email: '2025user2@wilp.bits-pilani.ac.in',
      displayName: 'User Two',
      avatarUrl: null,
    });

    const set1 = await setBackupEmail(db, user1.id, 'shared@gmail.com');
    expect(set1).toBe(true);

    const set2 = await setBackupEmail(db, user2.id, 'shared@gmail.com');
    expect(set2).toBe(false);
  });
});

describe('API: /api/auth/backup-email', () => {
  it('rejects unauthenticated requests', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      body: { email: 'backup@gmail.com' },
    });
    const res = await backupEmailPost(ctx);
    expect(res.status).toBe(401);
  });

  it('rejects POST with 410 Gone (typing backup email is discontinued)', async () => {
    const user = await createUser(db, {
      email: '2025student@wilp.bits-pilani.ac.in',
      displayName: 'Student',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user.id);

    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: user.email, status: 'active' },
      body: { email: 'backup@gmail.com' },
    });
    const res = await backupEmailPost(ctx);
    expect(res.status).toBe(410);

    const row = await findUserById(db, user.id);
    expect(row?.backup_email).toBeNull();
  });

  it('GET reflects eligible state and locked only when verified', async () => {
    const primary = '2025student@wilp.bits-pilani.ac.in';
    const user = await createUser(db, {
      email: primary,
      displayName: 'WILP Student',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user.id);

    // Initial GET: eligible=true, backupEmail=null, isLocked=false
    const getCtx1 = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/backup-email`,
      user: { id: user.id, email: primary, status: 'active' },
    });
    const getRes1 = await backupEmailGet(getCtx1);
    expect(getRes1.status).toBe(200);
    expect(await getRes1.json()).toEqual({
      eligible: true,
      backupEmail: null,
      isLocked: false,
    });

    // After backup is verified in DB
    await setBackupEmail(db, user.id, 'student.personal@gmail.com');

    const getCtx2 = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/backup-email`,
      user: { id: user.id, email: primary, status: 'active' },
    });
    const getRes2 = await backupEmailGet(getCtx2);
    expect(await getRes2.json()).toEqual({
      eligible: true,
      backupEmail: 'student.personal@gmail.com',
      isLocked: true,
    });

    // DELETE attempt returns 400
    const delCtx = makeContext({
      method: 'DELETE',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: primary, status: 'active' },
    });
    const delRes = await backupEmailDelete(delCtx);
    expect(delRes.status).toBe(400);
  });
});

describe('OAuth Callback: Connecting Backup Email to Main Account', () => {
  it('links backup email OAuth login directly to the main account when no identity exists', async () => {
    const mainPrimary = '2025wilp.student@wilp.bits-pilani.ac.in';
    const backupEmail = 'personal.wilp@gmail.com';

    const mainUser = await createUser(db, {
      email: mainPrimary,
      displayName: 'Main WILP Account',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    await verifyUserEmail(db, mainUser.id);
    await setBackupEmail(db, mainUser.id, backupEmail);

    expect(await findUserByBackupEmail(db, backupEmail)).toBeDefined();

    mockGoogleProfile.email = backupEmail;
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'google-sub-backup-personal-123';
    mockGoogleProfile.displayName = 'Personal Google Profile';

    const state = 'google_test-state-nonce';
    const stateCookie = await encodeOAuthState(
      {
        state,
        codeVerifier: 'verifier-123',
        provider: 'google',
        redirect: '/account',
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-xyz&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account');

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('__session=');

    const sessionTokenMatch = setCookie.match(/__session=([^;]+)/);
    expect(sessionTokenMatch).not.toBeNull();
    const claims = await verifyJwt(sessionTokenMatch![1], SECRET);
    expect(claims?.sub).toBe(mainUser.id);
    expect(claims?.email).toBe(mainPrimary);

    const identity = await findIdentity(db, 'google', 'google-sub-backup-personal-123');
    expect(identity).toBeDefined();
    expect(identity?.user_id).toBe(mainUser.id);
  });

  it('rejects linking unverified provider email to a backup account', async () => {
    const mainPrimary = '2025security@wilp.bits-pilani.ac.in';
    const backupEmail = 'unverified.target@gmail.com';

    const mainUser = await createUser(db, {
      email: mainPrimary,
      displayName: 'Main User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, mainUser.id);
    await setBackupEmail(db, mainUser.id, backupEmail);

    mockGoogleProfile.email = backupEmail;
    mockGoogleProfile.emailVerified = false;
    mockGoogleProfile.providerUid = 'fake-google-uid';

    const state = 'google_unverified_test';
    const stateCookie = await encodeOAuthState(
      {
        state,
        codeVerifier: 'verifier-456',
        provider: 'google',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-abc&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    // Unverified email redirects to pending verification without creating identities
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/verify-email?pending=1');

    const identity = await findIdentity(db, 'google', 'fake-google-uid');
    expect(identity).toBeNull();
  });

  it('does not merge accounts if Google identity already belongs to an existing user', async () => {
    const mainPrimary = '2025tanmay@wilp.bits-pilani.ac.in';
    const personalEmail = 'tanmaynemade@gmail.com';
    const googleUid = 'google-tanmay-uid-789';

    // 1. Separate personal user with Google identity
    const oldPersonalUser = await createUser(db, {
      email: personalEmail,
      displayName: 'Tanmay Personal',
      avatarUrl: null,
    });
    await verifyUserEmail(db, oldPersonalUser.id);
    await createIdentity(db, oldPersonalUser.id, 'google', googleUid);

    // 2. Main WILP account
    const mainUser = await createUser(db, {
      email: mainPrimary,
      displayName: 'Tanmay WILP',
      avatarUrl: null,
    });
    await verifyUserEmail(db, mainUser.id);
    await setBackupEmail(db, mainUser.id, personalEmail);

    // 3. User logs in with Google identity
    mockGoogleProfile.email = personalEmail;
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = googleUid;

    const state = 'google_existing_user_test';
    const stateCookie = await encodeOAuthState(
      {
        state,
        codeVerifier: 'verifier-789',
        provider: 'google',
        redirect: '/account',
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-tanmay&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(302);

    // Signs into personal user account (no auto-merge)
    const setCookie = res.headers.get('Set-Cookie') || '';
    const sessionTokenMatch = setCookie.match(/__session=([^;]+)/);
    const claims = await verifyJwt(sessionTokenMatch![1], SECRET);
    expect(claims?.sub).toBe(oldPersonalUser.id);

    // Both users remain active and separate
    const personalUserAfter = await findUserById(db, oldPersonalUser.id);
    expect(personalUserAfter?.status).toBe('active');
    const mainUserAfter = await findUserById(db, mainUser.id);
    expect(mainUserAfter?.status).toBe('active');
  });
});
