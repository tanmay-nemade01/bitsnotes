import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/notesLoader', () => ({
  listSubjects: vi.fn(async () => [{ name: 'NLP', lectureCount: 2 }]),
  listLectures: vi.fn(async (subject: string) =>
    subject === 'NLP'
      ? [{ folderName: 'Lecture_01', name: 'Lecture 1' }]
      : [],
  ),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { POST as feedbackPost, GET as feedbackGet } from '../src/pages/api/feedback/index';
import { upsertFeedback, getFeedbackAggregate } from '../src/lib/feedback';

const BASE = 'https://bitsnotes.com';
const SECRET = 'test-signing-key';

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
    FEEDBACK_RATE_LIMITER: undefined,
  });
});

describe('POST /api/feedback', () => {
  it('records a useful vote and issues a visitor cookie', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/feedback',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: 1 },
    });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.value).toBe(1);
    expect(res.headers.get('Set-Cookie')).toContain('bitsnotes-visitor=');
  });

  it('rejects CSRF (403)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/feedback',
      origin: 'https://evil.com',
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: 1 },
    });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(403);
  });

  it('rejects invalid value (400)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/feedback',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: 99 },
    });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('rejects unknown subject (400)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/feedback',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NOPE', lecture: 'Lecture_01', value: 1 },
    });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('rejects profane reason (400, but still no store of reason)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/feedback',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: -1, reason: 'you ass' },
    });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('upserts: changing vote updates aggregate', async () => {
    const ctx1 = makeContext({ method: 'POST', url: BASE + '/api/feedback', origin: BASE, body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: 1 } });
    const r1 = await feedbackPost(ctx1 as any);
    const cookie = r1.headers.get('Set-Cookie')!;
    const visitorId = cookie.match(/bitsnotes-visitor=([^;]+)/)![1];

    const ctx2 = makeContext({ method: 'POST', url: BASE + '/api/feedback', origin: BASE, cookie, body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: -1 } });
    const r2 = await feedbackPost(ctx2 as any);
    expect(r2.status).toBe(200);

    const { hashVisitor } = await import('../src/lib/visitor');
    const agg = await getFeedbackAggregate(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', visitorHash: await hashVisitor(visitorId, SECRET) });
    expect(agg).toEqual({ useful: 0, notYet: 1, myVote: -1 });
  });

  it('enforces rate limit (429)', async () => {
    setTestEnv({ DB: db, APP_BASE_URL: BASE, SESSION_SIGNING_KEY: SECRET, FEEDBACK_RATE_LIMITER: { limit: async () => ({ success: false }) } });
    const ctx = makeContext({ method: 'POST', url: BASE + '/api/feedback', origin: BASE, body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', value: 1 } });
    const res = await feedbackPost(ctx as any);
    expect(res.status).toBe(429);
  });
});

describe('GET /api/feedback', () => {
  it('returns aggregate and myVote from cookie', async () => {
    await upsertFeedback(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', visitorHash: 'vh', value: 1, reason: null });
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/feedback?pageType=lecture&subject=NLP&lecture=Lecture_01', cookie: 'bitsnotes-visitor=abc' });
    // Override visitor hash resolution by pre-seeding with the cookie-derived hash.
    const { hashVisitor } = await import('../src/lib/visitor');
    const vh = await hashVisitor('abc', SECRET);
    await upsertFeedback(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', visitorHash: vh, value: -1, reason: null });
    const res = await feedbackGet(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.useful).toBe(1);
    expect(data.notYet).toBe(1);
    expect(data.myVote).toBe(-1);
  });

  it('requires lecture for lecture pages (400)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/feedback?pageType=lecture&subject=NLP' });
    const res = await feedbackGet(ctx as any);
    expect(res.status).toBe(400);
  });
});
