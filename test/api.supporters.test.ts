import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { GET as supportersGet } from '../src/pages/api/supporters';
import { addSupporter, normalizeSupporterInput } from '../src/lib/supporters';
import fallbackSupporters from '../src/data/supporters';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  url?: string;
  user?: { id: string; email: string; displayName?: string; avatarUrl?: string; status: string } | null;
}): any {
  const url = opts.url || `${BASE}/api/supporters`;
  const request = new Request(url, { method: 'GET' });
  return {
    request,
    params: {},
    locals: {
      user: opts.user ?? null,
    },
    url: new URL(url),
  };
}

describe('GET /api/supporters (Privacy & Leak Prevention)', () => {
  let db: AuthDb;

  beforeEach(async () => {
    db = makeDb();
    setTestEnv({
      DB: db,
      APP_BASE_URL: BASE,
    });
  });

  it('hides supporters list from unauthenticated users and does not leak names', async () => {
    // Add supporters to DB
    const input1 = normalizeSupporterInput({ name: 'Alice Wonder', message: 'Keep it up!' });
    const input2 = normalizeSupporterInput({ name: 'Bob Builder', message: 'Awesome notes!' });
    if (input1.ok) await addSupporter(db, input1.value, 'admin-1');
    if (input2.ok) await addSupporter(db, input2.value, 'admin-1');

    // Call endpoint unauthenticated
    const ctx = makeContext({ user: null });
    const res = await supportersGet(ctx);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Must be marked unauthenticated
    expect(body.authenticated).toBe(false);

    // Total count can be known for social proof
    expect(body.total).toBe(2);

    // Crucial: supporters & latest lists must be empty
    expect(body.supporters).toEqual([]);
    expect(body.latest).toEqual([]);

    // Stringified response must NOT contain any supporter names or messages
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('Alice Wonder');
    expect(raw).not.toContain('Bob Builder');
    expect(raw).not.toContain('Keep it up!');
    expect(raw).not.toContain('Awesome notes!');

    // Also verify none of the fallback names are in the response
    for (const s of fallbackSupporters) {
      expect(raw).not.toContain(s.name);
    }
  });

  it('never leaks fallback supporter names to unauthenticated users when DB is down', async () => {
    // Simulate DB failure by not providing DB
    setTestEnv({
      DB: null as any,
      APP_BASE_URL: BASE,
    });

    const ctx = makeContext({ user: null });
    const res = await supportersGet(ctx);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.authenticated).toBe(false);
    expect(body.supporters).toEqual([]);
    expect(body.latest).toEqual([]);
    expect(body.total).toBe(fallbackSupporters.length);

    const raw = JSON.stringify(body);
    for (const s of fallbackSupporters) {
      expect(raw).not.toContain(s.name);
    }
  });

  it('returns supporters list to logged-in users', async () => {
    const input = normalizeSupporterInput({ name: 'Secret Supporter', message: 'Proud to back!', lecturesContributed: 4 });
    if (input.ok) await addSupporter(db, input.value, 'admin-1');

    const ctx = makeContext({
      user: {
        id: 'user-123',
        email: 'user@example.com',
        displayName: 'Test User',
        avatarUrl: null,
        status: 'active',
      },
    });

    const res = await supportersGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.authenticated).toBe(true);
    expect(body.total).toBe(1);
    expect(body.supporters).toHaveLength(1);
    expect(body.supporters[0].name).toBe('Secret Supporter');
    expect(body.supporters[0].message).toBe('Proud to back!');
    expect(body.supporters[0].lecturesContributed).toBe(4);
  });

  it('support page has SSR dynamic rendering and login gate contract', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve('src/pages/support.astro'), 'utf8');

    // Dynamic SSR so unauthenticated visitors receive clean HTML without supporter names
    expect(src).toContain('export const prerender = false;');

    // Login prompt for unauthenticated users
    expect(src).toContain('data-supporter-login-prompt');
    expect(src).toContain('/auth/signin?redirect=/support#wall-of-gratitude');
    expect(src).toContain('Sign in to view');
    expect(src).toContain('renderLoginPrompt');

    // User session reactivity
    expect(src).toContain('bitsnotes:user-updated');

    // Only populate arrays when logged in
    expect(src).toContain('const orderedSupporters = isLoggedIn ? allSupporters : [];');

    // Voluntary support section gate
    expect(src).toContain('data-support-login-prompt');
    expect(src).toContain('/auth/signin?redirect=/support#voluntary-support');
    expect(src).toContain('Sign in to support');

    // Payee and UPI details only generated when logged in
    expect(src).toContain('const upiParams = isLoggedIn ? new URLSearchParams(');
    expect(src).toContain('const widgetConfig = isLoggedIn ? {');
  });
});

