import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTestEnv, resetTestEnv } from './cloudflare-shim';
import { POST as contactPost } from '../src/pages/api/contact';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  method?: string;
  url?: string;
  body?: unknown;
  origin?: string;
  headers?: Record<string, string>;
}): any {
  const url = opts.url || `${BASE}/api/contact`;
  const headers = new Headers(opts.headers ?? {});
  if (opts.origin) headers.set('Origin', opts.origin);
  headers.set('Content-Type', 'application/json');

  const request = new Request(url, {
    method: opts.method || 'POST',
    headers,
    body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });

  return { request, params: {}, locals: {}, url: new URL(url) };
}

describe('POST /api/contact', () => {
  beforeEach(() => {
    resetTestEnv();
    setTestEnv({
      APP_BASE_URL: BASE,
      SEND_EMAIL: undefined,
      CONTACT_RATE_LIMITER: undefined,
    });
  });

  it('rejects CSRF when Origin is untrusted', async () => {
    const ctx = makeContext({
      origin: 'https://evil.com',
      body: { name: 'Alice', email: 'alice@example.com', subject: 'Help', message: 'Hello' },
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/CSRF/i);
  });

  it('accepts same-origin requests and simulates delivery when SEND_EMAIL is inactive', async () => {
    const ctx = makeContext({
      origin: BASE,
      body: { name: 'Alice', email: 'alice@example.com', subject: 'Help', message: 'Hello' },
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.simulated).toBe(true);
  });

  it('allows same-origin requests in local dev (localhost)', async () => {
    const ctx = makeContext({
      url: 'http://localhost:4321/api/contact',
      origin: 'http://localhost:4321',
      body: { name: 'Alice', email: 'alice@example.com', subject: 'Help', message: 'Hello' },
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('rejects invalid JSON body', async () => {
    const ctx = makeContext({
      origin: BASE,
      body: 'invalid json{',
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid JSON/i);
  });

  it('rejects missing fields', async () => {
    const ctx = makeContext({
      origin: BASE,
      body: { name: 'Alice', email: '', subject: 'Hi', message: 'Msg' },
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/required/i);
  });

  it('rejects invalid email address format', async () => {
    const ctx = makeContext({
      origin: BASE,
      body: { name: 'Alice', email: 'invalid-email', subject: 'Hi', message: 'Msg' },
    });
    const res = await contactPost(ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/valid email/i);
  });

  it('silently accepts honeypot submissions without sending email', async () => {
    const mockSend = vi.fn();
    setTestEnv({
      APP_BASE_URL: BASE,
      SEND_EMAIL: { send: mockSend },
    });

    const ctx = makeContext({
      origin: BASE,
      body: {
        name: 'Spam Bot',
        email: 'bot@spam.com',
        subject: 'Buy stuff',
        message: 'Spam body',
        _website: 'http://spam.com',
      },
    });

    const res = await contactPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('enforces rate limits when CONTACT_RATE_LIMITER triggers', async () => {
    setTestEnv({
      APP_BASE_URL: BASE,
      CONTACT_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });

    const ctx = makeContext({
      origin: BASE,
      body: { name: 'Alice', email: 'alice@example.com', subject: 'Hi', message: 'Hello' },
    });

    const res = await contactPost(ctx);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toMatch(/Too many messages/i);
  });

  it('sends email through SEND_EMAIL binding when active', async () => {
    class MockEmailMessage {
      from: string;
      to: string;
      raw: string;
      constructor(from: string, to: string, raw: string) {
        this.from = from;
        this.to = to;
        this.raw = raw;
      }
    }
    (globalThis as any).EmailMessage = MockEmailMessage;

    const mockSend = vi.fn(async () => {});
    setTestEnv({
      APP_BASE_URL: BASE,
      SEND_EMAIL: { send: mockSend },
    });

    const ctx = makeContext({
      origin: BASE,
      body: {
        name: 'Jane Doe\r\nInjected: Header',
        email: 'jane@example.com',
        subject: 'Test Subject\r\nBcc: evil@example.com',
        message: 'This is a test message.',
      },
    });

    const res = await contactPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentMsg = mockSend.mock.calls[0][0] as MockEmailMessage;
    expect(sentMsg.from).toBe('noreply@bitsnotes.com');
    expect(sentMsg.to).toBe('support@bitsnotes.com');
    // Header injection sanitized: CRLF removed
    expect(sentMsg.raw).toContain('Subject: [Contact Form] Test SubjectBcc: evil@example.com');
    expect(sentMsg.raw).toContain('Reply-To: Jane DoeInjected: Header <jane@example.com>');
    expect(sentMsg.raw).toContain('This is a test message.');

    delete (globalThis as any).EmailMessage;
  });

  it('returns user-friendly error when SEND_EMAIL send throws', async () => {
    class MockEmailMessage {
      constructor(public from: string, public to: string, public raw: string) {}
    }
    (globalThis as any).EmailMessage = MockEmailMessage;

    const mockSend = vi.fn(async () => {
      throw new Error('550 Destination address not verified');
    });
    setTestEnv({
      APP_BASE_URL: BASE,
      SEND_EMAIL: { send: mockSend },
    });

    const ctx = makeContext({
      origin: BASE,
      body: { name: 'Alice', email: 'alice@example.com', subject: 'Hi', message: 'Hello' },
    });

    const res = await contactPost(ctx);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('support@bitsnotes.com');

    delete (globalThis as any).EmailMessage;
  });
});
