import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import { setTestEnv } from './cloudflare-shim';
import { onRequest } from '../src/middleware';
import { createUser, verifyUserEmail } from '../src/lib/auth/db';
import { signJwt } from '../src/lib/auth/session';
import type { AuthDb } from '../src/lib/auth/db';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-session-signing-key';

describe('Middleware Session Authentication & Caching', () => {
  let db: AuthDb;

  beforeEach(() => {
    db = makeDb();
    setTestEnv({
      DB: db,
      APP_BASE_URL: BASE,
      SESSION_SIGNING_KEY: SECRET,
    });
  });

  it('populates Astro.locals.user and sets no-cache header if a valid __session cookie is provided', async () => {
    // 1. Create an active user
    const dbUser = await createUser(db, {
      email: 'test@example.com',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
    });
    await verifyUserEmail(db, dbUser.id);

    // 2. Generate a valid session JWT
    const token = await signJwt(
      { sub: dbUser.id, email: dbUser.email, tier: 'free', rt: 'dummy-refresh-id' },
      SECRET,
    );

    // 3. Prepare middleware context
    const request = new Request(`${BASE}/`, {
      headers: {
        'Cookie': `__session=${token}`,
      },
    });

    const locals: any = {};
    const context = {
      request,
      url: new URL(`${BASE}/`),
      locals,
    };

    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
      return new Response('OK', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    };

    // 4. Run middleware
    const res = await onRequest(context as any, next);

    expect(nextCalled).toBe(true);
    expect(res.status).toBe(200);
    expect(locals.user).toBeDefined();
    expect(locals.user.id).toBe(dbUser.id);
    expect(locals.user.email).toBe(dbUser.email);
    expect(locals.tier).toBe('free');

    // Caching check: personalized page must have noCacheHeader
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
  });

  it('does not populate Astro.locals.user and sets browser revalidation for anonymous HTML requests (missing cookie)', async () => {
    const request = new Request(`${BASE}/`, {
      headers: {},
    });

    const locals: any = {};
    const context = {
      request,
      url: new URL(`${BASE}/`),
      locals,
    };

    const next = async () => new Response('OK', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    const res = await onRequest(context as any, next);

    expect(locals.user).toBeNull();
    expect(locals.tier).toBe('free');

    // Caching check: anonymous public HTML page shell can be cached at edge but must be revalidated by the browser
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=600, must-revalidate');
    expect(res.headers.get('Vary')).toContain('Cookie');
  });

  it('does not populate Astro.locals.user and sets browser revalidation for anonymous HTML requests (invalid cookie)', async () => {
    const request = new Request(`${BASE}/`, {
      headers: {
        'Cookie': `__session=invalid-jwt-token-string`,
      },
    });

    const locals: any = {};
    const context = {
      request,
      url: new URL(`${BASE}/`),
      locals,
    };

    const next = async () => new Response('OK', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    const res = await onRequest(context as any, next);

    expect(locals.user).toBeNull();
    expect(locals.tier).toBe('free');

    // Caching check: anonymous public HTML page shell can be cached at edge but must be revalidated by the browser
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=600, must-revalidate');
    expect(res.headers.get('Vary')).toContain('Cookie');
  });
});
