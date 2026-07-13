import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/auth/oauth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/auth/oauth')>();
  return {
    ...original,
    googleExchangeCode: vi.fn(async () => ({
      provider: 'google',
      providerUid: '12345',
      email: 'test@example.com',
      emailVerified: true,
      displayName: 'Test User',
      avatarUrl: null,
    })),
    githubExchangeCode: vi.fn(async () => ({
      provider: 'github',
      providerUid: '67890',
      email: 'git@example.com',
      emailVerified: true,
      displayName: 'Github User',
      avatarUrl: null,
    })),
  };
});

// Mock email sending
vi.mock('../src/lib/auth/email', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { POST as signinPost } from '../src/pages/api/auth/signin';
import { GET as callbackGet } from '../src/pages/api/auth/callback/[provider]';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-session-signing-key';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  cookie?: string;
  headers?: Record<string, string>;
}): any {
  const headers = new Headers(opts.headers ?? {});
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
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
  });
});

describe('Auth Signin & Callback Flow', () => {
  it('successfully generates and verifies the OAuth state cookie, and redirects user on success', async () => {
    // 1. Trigger Signin (e.g. for Google)
    const signinCtx = makeContext({
      method: 'POST',
      url: `${BASE}/api/auth/signin`,
      origin: BASE,
      headers: { 'Content-Type': 'application/json' },
      body: { provider: 'google' },
    });
    const signinRes = await signinPost(signinCtx as any);
    expect(signinRes.status).toBe(200);

    const body = await signinRes.json();
    const cookieHeader = signinRes.headers.get('Set-Cookie');
    const stateCookie = cookieHeader?.match(/__oauth_state=([^;]+)/)?.[1];
    expect(stateCookie).toBeDefined();

    const redirectUrl = new URL(body.url);
    const returnedState = redirectUrl.searchParams.get('state');

    // 2. Callback with correct state + cookie
    const callbackCtx = makeContext({
      method: 'GET',
      url: `${BASE}/api/auth/callback/google?code=auth-code-123&state=${returnedState}`,
      cookie: `__oauth_state=${stateCookie}`,
    });

    const callbackRes = await callbackGet(callbackCtx as any);
    
    // With our fix, the state cookie signature will be verified successfully.
    // The endpoint should proceed, create the user/identity, sign a session JWT, and return a 302 redirect.
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location')).toBe('/');
    
    // Check that session cookies are set in the callback response
    const responseCookies = callbackRes.headers.get('Set-Cookie');
    expect(responseCookies).toContain('__session=');
    expect(responseCookies).toContain('__rt=');
    expect(responseCookies).toContain('__oauth_state=; Path=/api/auth/callback; HttpOnly;'); // should clear state cookie
  });
});
