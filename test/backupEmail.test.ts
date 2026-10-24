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
  validateBackupEmail,
} from '../src/lib/auth/backupEmail';
import {
  createUser,
  verifyUserEmail,
  findUserById,
  findUserByEmail,
  findUserByBackupEmail,
  setBackupEmail,
  findIdentity,
  hmacSign,
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

describe('Backup Email Eligibility & Validation', () => {
  it('correctly matches eligible WILP 2025 cohort emails', () => {
    expect(isBackupEmailEligible('2025hz12345@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBackupEmailEligible('2025h1030001p@wilp.bits-pilani.ac.in')).toBe(true);
    expect(isBackupEmailEligible('2025something@WILP.BITS-PILANI.AC.IN')).toBe(true);
  });

  it('rejects ineligible emails', () => {
    // Other cohort years
    expect(isBackupEmailEligible('2024hz12345@wilp.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('2026hz12345@wilp.bits-pilani.ac.in')).toBe(false);
    // Other campuses / domains
    expect(isBackupEmailEligible('2025h1030001p@pilani.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('2025h1030001p@goa.bits-pilani.ac.in')).toBe(false);
    expect(isBackupEmailEligible('student@gmail.com')).toBe(false);
    // Null / empty
    expect(isBackupEmailEligible(null)).toBe(false);
    expect(isBackupEmailEligible(undefined)).toBe(false);
    expect(isBackupEmailEligible('')).toBe(false);
  });

  it('validates backup email strings correctly', () => {
    const primary = '2025h1030001p@wilp.bits-pilani.ac.in';
    expect(validateBackupEmail('  Personal.Email@Gmail.COM  ', primary)).toEqual({
      email: 'personal.email@gmail.com',
    });

    // Same as primary
    expect(validateBackupEmail(primary, primary)).toEqual({
      error: 'Backup email must be different from your main email.',
    });

    // Malformed email
    expect(validateBackupEmail('not-an-email', primary)).toEqual({
      error: 'Enter a valid email address.',
    });

    // Missing
    expect(validateBackupEmail(null, primary)).toEqual({
      error: 'Backup email is required.',
    });
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

    // First attempt succeeds
    const firstSet = await setBackupEmail(db, user.id, 'backup1@gmail.com');
    expect(firstSet).toBe(true);

    const rowAfterFirst = await findUserById(db, user.id);
    expect(rowAfterFirst?.backup_email).toBe('backup1@gmail.com');
    expect(rowAfterFirst?.backup_email_verified_at).toBeGreaterThan(0);

    // Second attempt on the same user MUST return false (cannot change or overwrite)
    const secondSet = await setBackupEmail(db, user.id, 'backup2@gmail.com');
    expect(secondSet).toBe(false);

    // Stays as the original backup email
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

  it('rejects ineligible users', async () => {
    const user = await createUser(db, {
      email: 'regular.student@gmail.com',
      displayName: 'Regular Student',
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
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('not available');
  });

  it('allows eligible user to add backup email once, then blocks changes and deletions', async () => {
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

    // 1. POST first time: succeeds
    const postCtx1 = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: primary, status: 'active' },
      body: { email: 'student.personal@gmail.com' },
    });
    const postRes1 = await backupEmailPost(postCtx1);
    expect(postRes1.status).toBe(200);
    expect(await postRes1.json()).toEqual({
      success: true,
      backupEmail: 'student.personal@gmail.com',
      isLocked: true,
    });

    // GET after POST: isLocked=true
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

    // 2. POST second time: MUST FAIL (cannot be changed)
    const postCtx2 = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: primary, status: 'active' },
      body: { email: 'different.email@gmail.com' },
    });
    const postRes2 = await backupEmailPost(postCtx2);
    expect(postRes2.status).toBe(400);
    const postBody2 = await postRes2.json();
    expect(postBody2.error).toBe('Backup email has already been set and cannot be changed.');

    // 3. DELETE attempt: MUST FAIL (cannot be removed)
    const delCtx = makeContext({
      method: 'DELETE',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: primary, status: 'active' },
    });
    const delRes = await backupEmailDelete(delCtx);
    expect(delRes.status).toBe(400);
    const delBody = await delRes.json();
    expect(delBody.error).toBe('Backup email cannot be removed or changed once set.');

    // Check DB record is still the original backup email
    const row = await findUserById(db, user.id);
    expect(row?.backup_email).toBe('student.personal@gmail.com');
  });

  it('allows setting backup email even if it matches another user primary email', async () => {
    // Another user exists with primary email 'existing@gmail.com'
    const other = await createUser(db, {
      email: 'existing@gmail.com',
      displayName: 'Other',
      avatarUrl: null,
    });
    await verifyUserEmail(db, other.id);

    // Eligible WILP user
    const user = await createUser(db, {
      email: '2025candidate@wilp.bits-pilani.ac.in',
      displayName: 'Candidate',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user.id);

    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user.id, email: user.email, status: 'active' },
      body: { email: 'existing@gmail.com' },
    });
    const res = await backupEmailPost(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.backupEmail).toBe('existing@gmail.com');

    // Verify DB
    const row = await findUserById(db, user.id);
    expect(row?.backup_email).toBe('existing@gmail.com');
  });

  it('rejects setting backup email if it collides with another user verified backup email', async () => {
    // User 1 sets backup email
    const user1 = await createUser(db, {
      email: '2025first@wilp.bits-pilani.ac.in',
      displayName: 'First',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user1.id);
    await setBackupEmail(db, user1.id, 'shared.backup@gmail.com');

    // User 2 tries to set the same backup email
    const user2 = await createUser(db, {
      email: '2025second@wilp.bits-pilani.ac.in',
      displayName: 'Second',
      avatarUrl: null,
    });
    await verifyUserEmail(db, user2.id);

    const ctx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: user2.id, email: user2.email, status: 'active' },
      body: { email: 'shared.backup@gmail.com' },
    });
    const res = await backupEmailPost(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already registered as a backup email');
  });
});

describe('OAuth Callback: Connecting Backup Email to Main Account', () => {
  it('links backup email OAuth login directly to the main account and does not create a new user', async () => {
    const mainPrimary = '2025wilp.student@wilp.bits-pilani.ac.in';
    const backupEmail = 'personal.wilp@gmail.com';

    // 1. Create main account and set backup email
    const mainUser = await createUser(db, {
      email: mainPrimary,
      displayName: 'Main WILP Account',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    await verifyUserEmail(db, mainUser.id);
    await setBackupEmail(db, mainUser.id, backupEmail);

    expect(await findUserByBackupEmail(db, backupEmail)).toBeDefined();

    // 2. In future: User creates account / signs in with Google using their backup email
    mockGoogleProfile.email = backupEmail;
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'google-sub-backup-personal-123';
    mockGoogleProfile.displayName = 'Personal Google Profile';

    // Generate signed state cookie
    const state = 'google_test-state-nonce';
    const stateData = {
      state,
      codeVerifier: 'verifier-123',
      provider: 'google',
      redirect: '/account',
    };
    const payloadB64 = btoa(JSON.stringify(stateData));
    const sig = await hmacSign(SECRET, payloadB64);
    const stateCookie = `${payloadB64}.${sig}`;

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-xyz&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account');

    // Verify session cookies were set
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('__session=');

    // Extract session JWT claim
    const sessionTokenMatch = setCookie.match(/__session=([^;]+)/);
    expect(sessionTokenMatch).not.toBeNull();
    const sessionToken = sessionTokenMatch![1];
    const claims = await verifyJwt(sessionToken, SECRET);
    expect(claims).not.toBeNull();

    // THE KEY VERIFICATIONS:
    // A) The session sub must be the MAIN user's ID
    expect(claims?.sub).toBe(mainUser.id);
    // B) The session email claim must be the MAIN user's primary email
    expect(claims?.email).toBe(mainPrimary);

    // C) No new row in users table — only the 1 main user exists
    const allUsers = await db.prepare('SELECT * FROM users').all<any>();
    expect(allUsers.results.length).toBe(1);
    expect(allUsers.results[0].id).toBe(mainUser.id);

    // D) New identity was created in identities table pointing to mainUser.id
    const identity = await findIdentity(db, 'google', 'google-sub-backup-personal-123');
    expect(identity).toBeDefined();
    expect(identity?.user_id).toBe(mainUser.id);

    // E) Auth event backup_email_login logged
    const events = await db.prepare('SELECT * FROM auth_events WHERE user_id = ?').bind(mainUser.id).all<any>();
    const backupLoginEvent = events.results.find((e: any) => e.event === 'backup_email_login');
    expect(backupLoginEvent).toBeDefined();
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

    // Attacker or unverified OAuth returns emailVerified: false
    mockGoogleProfile.email = backupEmail;
    mockGoogleProfile.emailVerified = false;
    mockGoogleProfile.providerUid = 'fake-google-uid';

    const state = 'google_unverified_test';
    const stateData = {
      state,
      codeVerifier: 'verifier-456',
      provider: 'google',
      redirect: null,
    };
    const payloadB64 = btoa(JSON.stringify(stateData));
    const sig = await hmacSign(SECRET, payloadB64);
    const stateCookie = `${payloadB64}.${sig}`;

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-abc&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Please verify your email address on google');

    // No identity created
    const identity = await findIdentity(db, 'google', 'fake-google-uid');
    expect(identity).toBeNull();
  });

  it('connects to main account when backup email was previously registered as a separate user with existing identity', async () => {
    const mainPrimary = '2025tanmay@wilp.bits-pilani.ac.in';
    const personalEmail = 'tanmaynemade@gmail.com';
    const googleUid = 'google-tanmay-uid-789';

    // 1. User earlier logged in with personal gmail (creating old separate user row and identity)
    const oldPersonalUser = await createUser(db, {
      email: personalEmail,
      displayName: 'Tanmay Personal',
      avatarUrl: null,
    });
    await verifyUserEmail(db, oldPersonalUser.id);
    const { createIdentity } = await import('../src/lib/auth');
    await createIdentity(db, oldPersonalUser.id, 'google', googleUid);

    // 2. Main WILP account is registered and adds personalEmail as backup
    const mainUser = await createUser(db, {
      email: mainPrimary,
      displayName: 'Tanmay WILP',
      avatarUrl: null,
    });
    await verifyUserEmail(db, mainUser.id);
    await setBackupEmail(db, mainUser.id, personalEmail);

    // 3. User later logs in via Google with personalEmail
    mockGoogleProfile.email = personalEmail;
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = googleUid;

    const state = 'google_existing_user_test';
    const stateData = {
      state,
      codeVerifier: 'verifier-789',
      provider: 'google',
      redirect: '/account',
    };
    const payloadB64 = btoa(JSON.stringify(stateData));
    const sig = await hmacSign(SECRET, payloadB64);
    const stateCookie = `${payloadB64}.${sig}`;

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-tanmay&state=${state}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account');

    // 4. Verify the session belongs to mainUser
    const setCookie = res.headers.get('Set-Cookie') || '';
    const sessionTokenMatch = setCookie.match(/__session=([^;]+)/);
    expect(sessionTokenMatch).not.toBeNull();
    const claims = await verifyJwt(sessionTokenMatch![1], SECRET);
    expect(claims?.sub).toBe(mainUser.id);
    expect(claims?.email).toBe(mainPrimary);

    // 5. Verify provider identity was transferred to mainUser.id
    const identity = await findIdentity(db, 'google', googleUid);
    expect(identity?.user_id).toBe(mainUser.id);
  });
});

