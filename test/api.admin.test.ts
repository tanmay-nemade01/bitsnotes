import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { GET as adminGet } from '../src/pages/api/admin/comments/index';
import { POST as adminPost } from '../src/pages/api/admin/comments/[id]';
import { createComment, addAdmin } from '../src/lib/comments';

const BASE = 'https://bitsnotes.com';

function makeContext(opts: { method: string; url: string; body?: unknown; user?: any; params?: Record<string, string> }): any {
  const headers = new Headers();
  const request = new Request(opts.url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    request,
    params: opts.params ?? {},
    locals: { user: opts.user ?? null },
    url: new URL(opts.url),
  };
}

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
  setTestEnv({ DB: db, APP_BASE_URL: BASE });
});

describe('GET /api/admin/comments', () => {
  it('rejects anonymous (401)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments' });
    const res = await adminGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin user (403)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments', user: { id: 'u1' } });
    const res = await adminGet(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns comments for admin', async () => {
    await addAdmin(db, 'u1');
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'pending' });
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments?filter=pending', user: { id: 'u1' } });
    const res = await adminGet(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toHaveLength(1);
  });

  it('rejects invalid filter (400)', async () => {
    await addAdmin(db, 'u1');
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments?filter=bogus', user: { id: 'u1' } });
    const res = await adminGet(ctx as any);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/comments/[id]', () => {
  it('rejects non-admin (403)', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'pending' });
    const ctx = makeContext({ method: 'POST', url: BASE + '/api/admin/comments/' + comment.id, body: { action: 'publish' }, user: { id: 'u2' } });
    const res = await adminPost(ctx as any);
    expect(res.status).toBe(403);
  });

  it('publishes a pending comment (admin)', async () => {
    await addAdmin(db, 'u1');
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'pending' });
    const ctx = makeContext({ method: 'POST', url: BASE + '/api/admin/comments/' + comment.id, body: { action: 'publish' }, user: { id: 'u1' }, params: { id: comment.id } });
    const res = await adminPost(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('published');
  });

  it('rejects invalid action (400)', async () => {
    await addAdmin(db, 'u1');
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'pending' });
    const ctx = makeContext({ method: 'POST', url: BASE + '/api/admin/comments/' + comment.id, body: { action: 'explode' }, user: { id: 'u1' }, params: { id: comment.id } });
    const res = await adminPost(ctx as any);
    expect(res.status).toBe(400);
  });
});
