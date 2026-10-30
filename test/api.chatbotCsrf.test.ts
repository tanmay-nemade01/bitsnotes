import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import { setTestEnv } from './cloudflare-shim';
import type { AuthDb } from '../src/lib/auth/db';
import { POST as chatbotChatPost } from '../src/pages/api/chatbot/chat';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  headers?: Record<string, string>;
  user?: any;
}): any {
  const headers = new Headers(opts.headers ?? {});
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

beforeEach(() => {
  db = makeDb();
  setTestEnv({
    DB: db,
    APP_BASE_URL: BASE,
    OPENROUTER_API_KEY: 'test-key',
  });
});

describe('POST /api/chatbot/chat CSRF protection', () => {
  it('rejects request with missing Origin header (403)', async () => {
    const user = { id: 'u1', email: 'test@example.com' };
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/chatbot/chat',
      body: { messages: [{ role: 'user', content: 'hello' }] },
      user,
    });
    const res = await chatbotChatPost(ctx as any);
    expect(res.status).toBe(403);
  });

  it('rejects request with untrusted cross-origin Origin header (403)', async () => {
    const user = { id: 'u1', email: 'test@example.com' };
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/chatbot/chat',
      origin: 'https://evil.com',
      body: { messages: [{ role: 'user', content: 'hello' }] },
      user,
    });
    const res = await chatbotChatPost(ctx as any);
    expect(res.status).toBe(403);
  });
});

