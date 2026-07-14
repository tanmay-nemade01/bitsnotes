import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/notesLoader', () => ({
  listCatalog: vi.fn(async () => [
    {
      subject: 'NLP',
      lectures: [{ folderName: 'Lecture_01', name: 'Lecture 1', displayTitle: 'Lecture 1 Title' }],
    },
  ]),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { POST as markReadPost } from '../src/pages/api/progress/mark-read';
import { GET as listGet } from '../src/pages/api/progress/list';
import { GET as bootstrapGet } from '../src/pages/api/user/bootstrap';

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
    locals: { user: opts.user },
    url: new URL(opts.url),
  };
}

let db: AuthDb;
const testUser = {
  id: 'user1',
  email: 'test@example.com',
  displayName: 'Ada',
  avatarUrl: null,
  status: 'active',
};

beforeEach(async () => {
  db = makeDb();
  setTestEnv({
    DB: db,
    APP_BASE_URL: BASE,
  });

  // Insert user to satisfy FK
  await db.prepare(
    `INSERT INTO users (id, email, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).bind('user1', 'test@example.com', Date.now(), Date.now()).run();
});

describe('Progress APIs', () => {
  it('rejects unauthenticated requests', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/progress/mark-read',
      origin: BASE,
      body: { subject: 'NLP', lecture: 'Lecture_01', readPct: 50 },
    });
    const res = await markReadPost(ctx);
    expect(res.status).toBe(401);
  });

  it('marks overall lecture progress via POST', async () => {
    const ctx = makeContext({
      method: 'POST',
      url: BASE + '/api/progress/mark-read',
      origin: BASE,
      user: testUser,
      body: { subject: 'NLP', lecture: 'Lecture_01', readPct: 60 },
    });
    const res = await markReadPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Retrieve via list API
    const listCtx = makeContext({
      method: 'GET',
      url: BASE + '/api/progress/list?subject=NLP',
      user: testUser,
    });
    const listRes = await listGet(listCtx);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.lectures).toHaveLength(1);
    expect(listData.lectures[0].readPct).toBe(60);
  });

  it('marks topic progress and returns it in list and bootstrap endpoints', async () => {
    // Post topic 9.1 progress (total 2 topics)
    // 1 completed out of 2 = 50% parent lecture progress
    const ctx1 = makeContext({
      method: 'POST',
      url: BASE + '/api/progress/mark-read',
      origin: BASE,
      user: testUser,
      body: { subject: 'NLP', lecture: 'Lecture_01', topicId: '9.1', readPct: 80, totalTopics: 2 },
    });
    const res1 = await markReadPost(ctx1);
    expect(res1.status).toBe(200);

    // Verify topic progress is returned in list endpoint when lecture is specified
    const listCtx = makeContext({
      method: 'GET',
      url: BASE + '/api/progress/list?subject=NLP&lecture=Lecture_01',
      user: testUser,
    });
    const listRes = await listGet(listCtx);
    const listData = await listRes.json();
    expect(listData.lectures[0].readPct).toBe(50);
    expect(listData.topicProgress).toHaveLength(1);
    expect(listData.topicProgress[0].topicId).toBe('9.1');
    expect(listData.topicProgress[0].readPct).toBe(80);

    // Verify topic progress is returned in bootstrap endpoint
    const bootCtx = makeContext({
      method: 'GET',
      url: BASE + '/api/user/bootstrap?subject=NLP&lecture=Lecture_01',
      user: testUser,
    });
    const bootRes = await bootstrapGet(bootCtx);
    expect(bootRes.status).toBe(200);
    const bootData = await bootRes.json();
    expect(bootData.progress.topicProgress).toHaveLength(1);
    expect(bootData.progress.topicProgress[0].topicId).toBe('9.1');
  });
});
