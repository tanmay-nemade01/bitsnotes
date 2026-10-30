import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGoogleProfile = {
  provider: 'google',
  providerUid: 'g-default',
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
      providerUid: 'gh-default',
      email: 'git@example.com',
      emailVerified: true,
      displayName: 'Github User',
      avatarUrl: null,
    })),
  };
});

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import {
  createUser,
  verifyUserEmail,
  findUserById,
  findIdentity,
  createIdentity,
  decodeOAuthState,
  encodeOAuthState,
  verifyJwt,
} from '../src/lib/auth';
import { POST as backupEmailPost } from '../src/pages/api/auth/backup-email';
import { POST as linkBackupPost } from '../src/pages/api/auth/link-backup';
import { GET as callbackGet } from '../src/pages/api/auth/callback/[provider]';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-session-signing-key-backup-link';

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
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
  });
});

describe('Task 1 Acceptance Criteria — Link a backup Google account', () => {
  // 1. POST /api/auth/backup-email with a valid eligible session returns 410 and the DB row is unchanged.
  it('1. POST /api/auth/backup-email returns 410 and does not change DB', async () => {
    const user = await createUser(db, {
      email: '2025student@wilp.bits-pilani.ac.in',
      displayName: 'Eligible WILP User',
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
    expect(row?.backup_email_verified_at).toBeNull();
  });

  // 2. POST /api/auth/link-backup checks
  it('2. POST /api/auth/link-backup validates origin, auth, eligibility, already-linked, and returns Google consent URL + state', async () => {
    // Missing Origin -> 403
    const ctxNoOrigin = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      body: {},
    });
    expect((await linkBackupPost(ctxNoOrigin)).status).toBe(403);

    // Signed out -> 401
    const ctxSignedOut = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      body: {},
    });
    expect((await linkBackupPost(ctxSignedOut)).status).toBe(401);

    // Ineligible user -> 403
    const ineligible = await createUser(db, {
      email: 'regular@gmail.com',
      displayName: 'Ineligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, ineligible.id);
    const ctxIneligible = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: ineligible.id, email: ineligible.email, status: 'active' },
      body: {},
    });
    expect((await linkBackupPost(ctxIneligible)).status).toBe(403);

    // Eligible user
    const eligible = await createUser(db, {
      email: '2025eligible@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);

    // Already linked -> 400
    await db.prepare('UPDATE users SET backup_email = ?, backup_email_verified_at = ? WHERE id = ?')
      .bind('already@gmail.com', Date.now(), eligible.id)
      .run();
    const ctxAlreadyLinked = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: eligible.id, email: eligible.email, status: 'active' },
      body: {},
    });
    expect((await linkBackupPost(ctxAlreadyLinked)).status).toBe(400);

    // Reset backup email for eligible test
    await db.prepare('UPDATE users SET backup_email = NULL, backup_email_verified_at = NULL WHERE id = ?')
      .bind(eligible.id)
      .run();

    // Eligible -> 200 with consent URL and signed state cookie
    const ctxEligible = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: eligible.id, email: eligible.email, status: 'active' },
      body: {},
    });
    const resEligible = await linkBackupPost(ctxEligible);
    expect(resEligible.status).toBe(200);
    const data = await resEligible.json();
    expect(data.url).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(data.url).toMatch(/prompt=select_account(\+|\%20)consent/);

    const setCookie = resEligible.headers.get('Set-Cookie');
    const stateMatch = setCookie?.match(/(?:^|;\s*)__oauth_state=([^;]+)/);
    expect(stateMatch).not.toBeNull();
    const decoded = await decodeOAuthState(stateMatch![1], SECRET);
    expect(decoded?.intent).toBe('link_backup');
    expect(decoded?.linkUserId).toBe(eligible.id);
  });

  // 3. Full link flow
  it('3. Full link flow links backup email + identity, redirects to /account?backup=linked, sets no session cookies', async () => {
    const eligible = await createUser(db, {
      email: '2025wilp@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);

    // Start link-backup
    const linkRes = await linkBackupPost(makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: eligible.id, email: eligible.email, status: 'active' },
      body: {},
    }));
    const { url } = await linkRes.json();
    const stateParam = new URL(url).searchParams.get('state');
    const stateCookie = linkRes.headers.get('Set-Cookie')!.match(/(?:^|;\s*)__oauth_state=([^;]+)/)![1];

    // Mock Google response
    mockGoogleProfile.email = 'backup@gmail.com';
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'g-backup';

    // Callback
    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-123&state=${stateParam}`,
      cookie: `__oauth_state=${stateCookie}`,
    });
    const res = await callbackGet(callbackCtx);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account?backup=linked');

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).not.toContain('__session=');
    expect(setCookie).not.toContain('__rt=');
    expect(setCookie).toContain('__oauth_state=');

    // DB verification
    const row = await findUserById(db, eligible.id);
    expect(row?.backup_email).toBe('backup@gmail.com');
    expect(row?.backup_email_verified_at).not.toBeNull();

    const identity = await findIdentity(db, 'google', 'g-backup');
    expect(identity?.user_id).toBe(eligible.id);
  });

  // 4. Link flow where Google email belongs to another user's primary email
  it('4. Link flow where Google email belongs to another user primary email redirects with backup_error=has_account and leaves other user untouched', async () => {
    const victim = await createUser(db, {
      email: 'victim@gmail.com',
      displayName: 'Victim User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, victim.id);
    await createIdentity(db, victim.id, 'google', 'g-victim');

    const attacker = await createUser(db, {
      email: '2025attacker@wilp.bits-pilani.ac.in',
      displayName: 'Attacker User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, attacker.id);

    const linkRes = await linkBackupPost(makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: attacker.id, email: attacker.email, status: 'active' },
      body: {},
    }));
    const { url } = await linkRes.json();
    const stateParam = new URL(url).searchParams.get('state');
    const stateCookie = linkRes.headers.get('Set-Cookie')!.match(/(?:^|;\s*)__oauth_state=([^;]+)/)![1];

    mockGoogleProfile.email = 'victim@gmail.com';
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'g-attacker-attempt';

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-victim&state=${stateParam}`,
      cookie: `__oauth_state=${stateCookie}`,
    });
    const res = await callbackGet(callbackCtx);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account?backup_error=has_account');

    // Victim untouched
    const victimAfter = await findUserById(db, victim.id);
    expect(victimAfter?.status).toBe('active');
    expect(victimAfter?.email).toBe('victim@gmail.com');
    const victimIdent = await findIdentity(db, 'google', 'g-victim');
    expect(victimIdent?.user_id).toBe(victim.id);

    // Attacker has no backup email set
    const attackerAfter = await findUserById(db, attacker.id);
    expect(attackerAfter?.backup_email).toBeNull();
  });

  // 5. Link flow with emailVerified: false
  it('5. Link flow with unverified Google email redirects with backup_error=unverified and writes nothing', async () => {
    const eligible = await createUser(db, {
      email: '2025wilp@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);

    const linkRes = await linkBackupPost(makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: eligible.id, email: eligible.email, status: 'active' },
      body: {},
    }));
    const { url } = await linkRes.json();
    const stateParam = new URL(url).searchParams.get('state');
    const stateCookie = linkRes.headers.get('Set-Cookie')!.match(/(?:^|;\s*)__oauth_state=([^;]+)/)![1];

    mockGoogleProfile.email = 'unverified@gmail.com';
    mockGoogleProfile.emailVerified = false;
    mockGoogleProfile.providerUid = 'g-unverified';

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-xyz&state=${stateParam}`,
      cookie: `__oauth_state=${stateCookie}`,
    });
    const res = await callbackGet(callbackCtx);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account?backup_error=unverified');

    const row = await findUserById(db, eligible.id);
    expect(row?.backup_email).toBeNull();
  });

  // 6. Tampered state cookie
  it('6. Tampered state cookie returns 400 and writes nothing', async () => {
    const eligible = await createUser(db, {
      email: '2025wilp@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);

    const linkRes = await linkBackupPost(makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/link-backup`,
      origin: BASE,
      user: { id: eligible.id, email: eligible.email, status: 'active' },
      body: {},
    }));
    const { url } = await linkRes.json();
    const stateParam = new URL(url).searchParams.get('state');
    const stateCookie = linkRes.headers.get('Set-Cookie')!.match(/(?:^|;\s*)__oauth_state=([^;]+)/)![1];

    // Tamper one char in payload
    const dotIdx = stateCookie.indexOf('.');
    const tampered = 'X' + stateCookie.slice(1);

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-xyz&state=${stateParam}`,
      cookie: `__oauth_state=${tampered}`,
    });
    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(400);

    const row = await findUserById(db, eligible.id);
    expect(row?.backup_email).toBeNull();
  });

  // 7. State cookie with issuedAt older than 10 minutes
  it('7. State cookie older than 10 minutes is rejected', async () => {
    const eligible = await createUser(db, {
      email: '2025wilp@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);

    const expiredPayload = {
      state: 'google_expired_state',
      codeVerifier: 'verifier-exp',
      provider: 'google' as const,
      redirect: '/account',
      intent: 'link_backup' as const,
      linkUserId: eligible.id,
      issuedAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
    };
    const expiredCookie = await encodeOAuthState(expiredPayload, SECRET);

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-xyz&state=google_expired_state`,
      cookie: `__oauth_state=${expiredCookie}`,
    });
    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(400);

    const row = await findUserById(db, eligible.id);
    expect(row?.backup_email).toBeNull();
  });

  // 8. After linking, normal login via Google with providerUid: 'g-backup' logs in as eligible user
  it('8. Normal login after linking signs in as the eligible user with session cookies', async () => {
    const eligible = await createUser(db, {
      email: '2025student@wilp.bits-pilani.ac.in',
      displayName: 'Eligible User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, eligible.id);
    await db.prepare('UPDATE users SET backup_email = ?, backup_email_verified_at = ? WHERE id = ?')
      .bind('backup@gmail.com', Date.now(), eligible.id)
      .run();
    await createIdentity(db, eligible.id, 'google', 'g-backup');

    mockGoogleProfile.email = 'backup@gmail.com';
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'g-backup';

    const loginPayload = {
      state: 'google_login_state',
      codeVerifier: 'verifier-login',
      provider: 'google' as const,
      redirect: '/dashboard',
      intent: 'login' as const,
      linkUserId: null,
      issuedAt: Date.now(),
    };
    const loginCookie = await encodeOAuthState(loginPayload, SECRET);

    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-login&state=google_login_state`,
      cookie: `__oauth_state=${loginCookie}`,
    });
    const res = await callbackGet(callbackCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('__session=');
    expect(setCookie).toContain('__rt=');

    const sessionMatch = setCookie.match(/(?:^|;\s*)__session=([^;]+)/);
    const claims = await verifyJwt(sessionMatch![1], SECRET);
    expect(claims?.sub).toBe(eligible.id);
  });

  // 9. Regression for original attack
  it('9. Original attack regression: User A cannot steal User B account via backup-email', async () => {
    // User B (victim)
    const victim = await createUser(db, {
      email: 'victim@gmail.com',
      displayName: 'Victim B',
      avatarUrl: null,
    });
    await verifyUserEmail(db, victim.id);
    await createIdentity(db, victim.id, 'google', 'g-victim-uid');
    await db.prepare('INSERT INTO collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('col-1', victim.id, 'Default', Date.now())
      .run();
    await db.prepare('INSERT INTO bookmarks (id, user_id, collection_id, subject, lecture, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('b-1', victim.id, 'col-1', 'Math', 'Lecture 1', 'Math Lec 1', Date.now())
      .run();

    // User A (attacker, eligible)
    const attacker = await createUser(db, {
      email: '2025attacker@wilp.bits-pilani.ac.in',
      displayName: 'Attacker A',
      avatarUrl: null,
    });
    await verifyUserEmail(db, attacker.id);

    // Attacker tries POST /api/auth/backup-email with victim's email -> 410
    const attackCtx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/backup-email`,
      origin: BASE,
      user: { id: attacker.id, email: attacker.email, status: 'active' },
      body: { email: 'victim@gmail.com' },
    });
    const attackRes = await backupEmailPost(attackCtx);
    expect(attackRes.status).toBe(410);

    // Victim logs in normally with Google
    mockGoogleProfile.email = 'victim@gmail.com';
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'g-victim-uid';

    const victimLoginState = {
      state: 'google_victim_login',
      codeVerifier: 'verifier-victim',
      provider: 'google' as const,
      redirect: '/',
      intent: 'login' as const,
      linkUserId: null,
      issuedAt: Date.now(),
    };
    const victimCookie = await encodeOAuthState(victimLoginState, SECRET);

    const victimCallbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-victim&state=google_victim_login`,
      cookie: `__oauth_state=${victimCookie}`,
    });
    const victimRes = await callbackGet(victimCallbackCtx);
    expect(victimRes.status).toBe(302);

    const setCookie = victimRes.headers.get('Set-Cookie') || '';
    const sessionMatch = setCookie.match(/(?:^|;\s*)__session=([^;]+)/);
    const claims = await verifyJwt(sessionMatch![1], SECRET);
    expect(claims?.sub).toBe(victim.id);

    // Victim's account is still active and bookmarks intact
    const victimRow = await findUserById(db, victim.id);
    expect(victimRow?.status).toBe('active');
    expect(victimRow?.email).toBe('victim@gmail.com');

    const victimBookmarks = await db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').bind(victim.id).all<any>();
    expect(victimBookmarks.results.length).toBe(1);
  });
});
