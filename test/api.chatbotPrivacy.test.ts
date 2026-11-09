import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import { setTestEnv } from './cloudflare-shim';
import type { AuthDb } from '../src/lib/auth/db';
import { POST as chatbotChatPost } from '../src/pages/api/chatbot/chat';
import { GET as chatbotUsageGet } from '../src/pages/api/chatbot/usage';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  user?: any;
}): any {
  const headers = new Headers();
  if (opts.origin) headers.set('Origin', opts.origin);
  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    params: {},
    locals: { user: opts.user ?? null, isAdmin: false },
    url: new URL(opts.url),
  };
}

let db: AuthDb;

async function seedUser(id: string, limit: number): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at, status, chatbot_limit)
       VALUES (?, ?, 'Test User', ?, ?, 'active', ?)`
    )
    .bind(id, `${id}@example.com`, now, now, limit)
    .run();
}

beforeEach(() => {
  db = makeDb();
  setTestEnv({
    DB: db,
    APP_BASE_URL: BASE,
    OPENROUTER_API_KEY: 'test-key',
  });
});

describe('Chatbot quota privacy', () => {
  it('does not expose quota numbers when the daily fair-use limit is exceeded', async () => {
    await seedUser('u-quota', 0);

    const user = { id: 'u-quota', email: 'u-quota@example.com' };
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/chatbot/chat',
      origin: BASE,
      user,
      body: {
        messages: [{ role: 'user', content: 'hello' }],
        query: 'hello',
      },
    });

    const res = await chatbotChatPost(ctx as any);
    expect(res.status).toBe(429);

    const data = await res.json() as Record<string, unknown>;
    expect(data.limitReached).toBe(true);
    expect(typeof data.error).toBe('string');
    expect(data).not.toHaveProperty('used');
    expect(data).not.toHaveProperty('limit');
    expect(data).not.toHaveProperty('remaining');
    expect(data).not.toHaveProperty('unlimited');
  });

  it('returns no quota details from the public usage endpoint', async () => {
    const ctx = makeContext({
      method: 'GET',
      url: BASE + '/api/chatbot/usage',
      user: { id: 'u-any', email: 'any@example.com' },
    });

    const res = await chatbotUsageGet(ctx as any);
    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data).toEqual({ ok: true });
  });
});
