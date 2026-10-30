import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGoogleProfile = {
  provider: 'google',
  providerUid: 'g-default',
  email: 'test@example.com',
  emailVerified: true,
  displayName: 'Test User',
  avatarUrl: null,
};

const mockGithubProfile = {
  provider: 'github',
  providerUid: 'gh-default',
  email: 'git@example.com',
  emailVerified: true,
  displayName: 'Github User',
  avatarUrl: null,
};

vi.mock('../src/lib/auth/oauth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/auth/oauth')>();
  return {
    ...original,
    googleExchangeCode: vi.fn(async () => ({ ...mockGoogleProfile })),
    githubExchangeCode: vi.fn(async () => ({ ...mockGithubProfile })),
  };
});

const { sendVerificationEmailMock } = vi.hoisted(() => ({
  sendVerificationEmailMock: vi.fn(async () => {}),
}));
vi.mock('../src/lib/auth/email', () => ({
  sendVerificationEmail: sendVerificationEmailMock,
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import {
  createUser,
  verifyUserEmail,
  findUserById,
  findIdentity,
  createIdentity,
  encodeOAuthState,
  verifyJwt,
} from '../src/lib/auth';
import { GET as callbackGet } from '../src/pages/api/auth/callback/[provider]';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-session-signing-key-verified';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  cookie?: string;
}): any {
  const headers = new Headers();
  if (opts.origin) headers.set('Origin', opts.origin);
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { request, params: {}, locals: {}, url: new URL(opts.url) };
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
  sendVerificationEmailMock.mockClear();
});

describe('Task 2 Acceptance Criteria — Only trust provider-verified emails', () => {
  // 1. New user via GitHub with emailVerified: false
  it('1. New user with emailVerified: false redirects to pending, no DB row created, no email sent', async () => {
    mockGithubProfile.email = 'newunverified@example.com';
    mockGithubProfile.emailVerified = false;
    mockGithubProfile.providerUid = 'gh-unverified-1';

    const stateToken = await encodeOAuthState(
      {
        state: 'gh_state_1',
        codeVerifier: 'verifier_1',
        provider: 'github',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const ctx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/github?code=code-1&state=gh_state_1`,
      cookie: `__oauth_state=${stateToken}`,
    });

    const res = await callbackGet(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/verify-email?pending=1');

    const users = await db.prepare('SELECT * FROM users').all<any>();
    expect(users.results.length).toBe(0);

    const identities = await db.prepare('SELECT * FROM identities').all<any>();
    expect(identities.results.length).toBe(0);

    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  // 2. Existing active user, GitHub login with unverified email
  it('2. Existing active user cannot be hijacked by unverified GitHub login', async () => {
    const victim = await createUser(db, {
      email: 'victim@example.com',
      displayName: 'Victim User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, victim.id);
    await createIdentity(db, victim.id, 'google', 'g-victim');

    mockGithubProfile.email = 'victim@example.com';
    mockGithubProfile.emailVerified = false;
    mockGithubProfile.providerUid = 'gh-attacker';

    const stateToken = await encodeOAuthState(
      {
        state: 'gh_state_2',
        codeVerifier: 'verifier_2',
        provider: 'github',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const ctx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/github?code=code-2&state=gh_state_2`,
      cookie: `__oauth_state=${stateToken}`,
    });

    const res = await callbackGet(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/verify-email?pending=1');

    const ghIdent = await findIdentity(db, 'github', 'gh-attacker');
    expect(ghIdent).toBeNull();
  });

  // 3. Same as 2 but emailVerified: true -> links identity
  it('3. Existing active user links verified GitHub identity and creates session', async () => {
    const victim = await createUser(db, {
      email: 'victim@example.com',
      displayName: 'Victim User',
      avatarUrl: null,
    });
    await verifyUserEmail(db, victim.id);
    await createIdentity(db, victim.id, 'google', 'g-victim');

    mockGithubProfile.email = 'victim@example.com';
    mockGithubProfile.emailVerified = true;
    mockGithubProfile.providerUid = 'gh-legit';

    const stateToken = await encodeOAuthState(
      {
        state: 'gh_state_3',
        codeVerifier: 'verifier_3',
        provider: 'github',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const ctx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/github?code=code-3&state=gh_state_3`,
      cookie: `__oauth_state=${stateToken}`,
    });

    const res = await callbackGet(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');

    const ghIdent = await findIdentity(db, 'github', 'gh-legit');
    expect(ghIdent).not.toBeNull();
    expect(ghIdent?.user_id).toBe(victim.id);

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('__session=');
  });

  // 4. Pre-hijack scenario
  it('4. Pre-hijack: pending account dropped links when verified owner signs in; attacker locked out', async () => {
    // 1. Attacker created pending user with victim email and attacker-gh identity
    const pendingUser = await createUser(db, {
      email: 'victim@example.com',
      displayName: 'Squatted Account',
      avatarUrl: null,
    });
    // Remains pending
    await createIdentity(db, pendingUser.id, 'github', 'attacker-gh');
    await db.prepare('INSERT INTO verification_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('tok_hash', pendingUser.id, 'signup', Date.now() + 10000, Date.now())
      .run();

    // 2. Real victim signs in with verified Google account
    mockGoogleProfile.email = 'victim@example.com';
    mockGoogleProfile.emailVerified = true;
    mockGoogleProfile.providerUid = 'g-victim-real';

    const googleStateToken = await encodeOAuthState(
      {
        state: 'google_state_victim',
        codeVerifier: 'verifier_g',
        provider: 'google',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const victimCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=code-victim&state=google_state_victim`,
      cookie: `__oauth_state=${googleStateToken}`,
    });

    const victimRes = await callbackGet(victimCtx);
    expect(victimRes.status).toBe(302);
    expect(victimRes.headers.get('Location')).toBe('/');

    // Victim gets session, user is now active
    const userRow = await findUserById(db, pendingUser.id);
    expect(userRow?.status).toBe('active');

    // Attacker's GitHub identity no longer exists!
    const attackerIdent = await findIdentity(db, 'github', 'attacker-gh');
    expect(attackerIdent).toBeNull();

    // 3. Attacker tries to log in with attacker-gh, emailVerified: false
    mockGithubProfile.email = 'attacker@evil.com';
    mockGithubProfile.emailVerified = false;
    mockGithubProfile.providerUid = 'attacker-gh';

    const attackerStateToken = await encodeOAuthState(
      {
        state: 'gh_state_attacker',
        codeVerifier: 'verifier_att',
        provider: 'github',
        redirect: null,
        intent: 'login',
        linkUserId: null,
        issuedAt: Date.now(),
      },
      SECRET,
    );

    const attackerCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/github?code=code-att&state=gh_state_attacker`,
      cookie: `__oauth_state=${attackerStateToken}`,
    });

    const attackerRes = await callbackGet(attackerCtx);
    // Redirects to pending, does NOT log into victim's account
    expect(attackerRes.status).toBe(302);
    expect(attackerRes.headers.get('Location')).toBe('/auth/verify-email?pending=1');
  });

  // 5. Unit test for githubExchangeCode email selection
  it('5. githubExchangeCode email selection returns verified email even if primary is unverified', async () => {
    // We unmock oauth or import original to test githubExchangeCode directly
    const { githubExchangeCode } = await vi.importActual<typeof import('../src/lib/auth/oauth')>('../src/lib/auth/oauth');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any, _init?: any) => {
      const url = String(input);
      if (url.includes('access_token')) {
        return new Response(JSON.stringify({ access_token: 'gh-mock-token' }), { status: 200 });
      }
      if (url.includes('/user/emails')) {
        return new Response(
          JSON.stringify([
            { email: 'unverified-primary@example.com', primary: true, verified: false },
            { email: 'verified-secondary@example.com', primary: false, verified: true },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/user')) {
        return new Response(
          JSON.stringify({ id: 12345, login: 'testuser', name: 'Test User', avatar_url: null }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    try {
      const profile = await githubExchangeCode(
        { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost' },
        'auth-code',
        'verifier',
      );
      expect(profile.email).toBe('verified-secondary@example.com');
      expect(profile.emailVerified).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
