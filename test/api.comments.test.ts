import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the manifest so route-level subject/lecture existence checks pass
// without touching R2 / the filesystem.
vi.mock('../src/utils/notesLoader', () => ({
  listSubjects: vi.fn(async () => [{ name: 'NLP', lectureCount: 2 }]),
  listLectures: vi.fn(async (subject: string) =>
    subject === 'NLP'
      ? [
          { folderName: 'Lecture_01', name: 'Lecture 1' },
          { folderName: 'Lecture_02', name: 'Lecture 2' },
        ]
      : [],
  ),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { POST as commentsPost, GET as commentsGet } from '../src/pages/api/comments/index';
import { DELETE as commentsDelete } from '../src/pages/api/comments/[id]';
import { POST as votePost } from '../src/pages/api/comments/[id]/vote';
import { createComment } from '../src/lib/comments';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  method: string;
  url: string;
  body?: unknown;
  origin?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}): any {
  const headers = new Headers(opts.headers ?? {});
  if (opts.origin) headers.set('Origin', opts.origin);
  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  // Ensure content-length is present for the size cap check.
  if (opts.body !== undefined && !headers.has('content-length')) {
    // Request sets it automatically for string bodies.
  }
  return {
    request,
    params: opts.params ?? {},
    locals: {},
    url: new URL(opts.url),
  };
}

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
  setTestEnv({
    DB: db,
    APP_BASE_URL: BASE,
    // No TURNSTILE_SECRET_KEY => Turnstile skipped (local-dev path).
    COMMENT_RATE_LIMITER: undefined,
  });
});

describe('POST /api/comments', () => {
  it('publishes a clean comment (201)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: {
        pageType: 'lecture',
        subject: 'NLP',
        lecture: 'Lecture_01',
        displayName: 'Ada',
        body: 'This was very helpful, thank you!',
        formStartedAt: Date.now() - 5000,
      },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('published');
    expect(data.token).toBeTruthy();
  });

  it('rejects CSRF (no same-origin Origin)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: 'https://evil.com',
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'hi there friend' },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(403);
  });

  it('fakes success on honeypot hit (no store)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'hi', _website: 'spam@example.com' },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeNull();
    // Nothing stored.
    const list = await (await import('../src/lib/comments')).listComments(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01' });
    expect(list.total).toBe(0);
  });

  it('fakes success when submitted too fast (bot-like)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'hi there', formStartedAt: Date.now() },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeNull();
  });

  it('rejects profanity with 422 (no store)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'Ada', body: 'you ass', formStartedAt: Date.now() - 5000 },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(422);
    const list = await (await import('../src/lib/comments')).listComments(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01' });
    expect(list.total).toBe(0);
  });

  it('rejects unknown subject (400)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NOPE', lecture: 'Lecture_01', displayName: 'A', body: 'hi there friend', formStartedAt: Date.now() - 5000 },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('rejects unknown lecture (400)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_99', displayName: 'A', body: 'hi there friend', formStartedAt: Date.now() - 5000 },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('holds spam as pending (202)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'Ada', body: 'buy now aaaaaaaaaaaaaaaaaaaaa https://spam.com', formStartedAt: Date.now() - 5000 },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.status).toBe('pending');
  });

  it('enforces rate limit (429)', async () => {
    setTestEnv({
      DB: db,
      APP_BASE_URL: BASE,
      COMMENT_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'hi there friend', formStartedAt: Date.now() - 5000 },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(429);
  });
});

describe('GET /api/comments', () => {
  it('returns published comments only', async () => {
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'visible', status: 'published' });
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'B', body: 'hidden', status: 'hidden' });
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/comments?pageType=lecture&subject=NLP&lecture=Lecture_01' });
    const res = await commentsGet(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it('requires lecture for lecture pages (400)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/comments?pageType=lecture&subject=NLP' });
    const res = await commentsGet(ctx as any);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/comments/[id]', () => {
  it('self-deletes with token', async () => {
    const { token, comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'DELETE',
      url: BASE + '/api/comments/' + comment.id,
      origin: BASE,
      body: { token },
      params: { id: comment.id },
    });
    const res = await commentsDelete(ctx as any);
    expect(res.status).toBe(200);
  });

  it('rejects missing token (401)', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'DELETE',
      url: BASE + '/api/comments/' + comment.id,
      origin: BASE,
      body: {},
      params: { id: comment.id },
    });
    const res = await commentsDelete(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rejects CSRF (403)', async () => {
    const { token, comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'DELETE',
      url: BASE + '/api/comments/' + comment.id,
      origin: 'https://evil.com',
      body: { token },
      params: { id: comment.id },
    });
    const res = await commentsDelete(ctx as any);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/comments/[id]/vote', () => {
  it('records an upvote and returns score', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments/' + comment.id + '/vote',
      origin: BASE,
      body: { value: 1 },
      params: { id: comment.id },
    });
    const res = await votePost(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.score).toBe(1);
    expect(data.myVote).toBe(1);
  });

  it('rejects invalid value (400)', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments/' + comment.id + '/vote',
      origin: BASE,
      body: { value: 5 },
      params: { id: comment.id },
    });
    const res = await votePost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('rejects CSRF (403)', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'x', status: 'published' });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments/' + comment.id + '/vote',
      origin: 'https://evil.com',
      body: { value: 1 },
      params: { id: comment.id },
    });
    const res = await votePost(ctx as any);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/comments (replies)', () => {
  it('creates a reply to a published comment (201)', async () => {
    const { comment: top } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'top', status: 'published' });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: {
        pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01',
        displayName: 'Bob', body: 'a reply', parentId: top.id, formStartedAt: Date.now() - 5000,
      },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.parentId).toBe(top.id);
  });

  it('rejects reply whose parent is on a different page (400)', async () => {
    const { comment: top } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01', displayName: 'A', body: 'top', status: 'published' });
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: {
        pageType: 'subject', subject: 'NLP',
        displayName: 'B', body: 'a reply', parentId: top.id, formStartedAt: Date.now() - 5000,
      },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('rejects reply to unknown parent (400)', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/comments',
      origin: BASE,
      body: {
        pageType: 'lecture', subject: 'NLP', lecture: 'Lecture_01',
        displayName: 'B', body: 'a reply', parentId: '00000000-0000-0000-0000-000000000000', formStartedAt: Date.now() - 5000,
      },
    });
    const res = await commentsPost(ctx as any);
    expect(res.status).toBe(400);
  });
});
