import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/notesLoader', () => ({
  listCatalog: vi.fn(async () => [
    {
      subject: 'OperatingSystems',
      lectureCount: 1,
      lectures: [
        {
          name: 'Lecture 1',
          folderName: 'lect-1',
          fileName: 'lecture-1',
          topicTitle: 'Intro',
          displayTitle: 'Intro to OS',
          slug: 'lect-1',
          resourceKind: 'notes',
          availableModes: ['read'],
          scope: 'public',
          sortOrder: 1,
          metadataSource: 'companion',
          authoredQuizCount: 0,
        }
      ]
    }
  ]),
  listSubjects: vi.fn(async () => [{ name: 'NLP', lectureCount: 2 }]),
  listLectures: vi.fn(async () => []),
  getManifest: vi.fn(async () => ({
    version: 'dev-manifest',
    subjects_count: 1,
    total_lectures: 1,
    updatedAt: '',
    subjects: [
      {
        name: 'OperatingSystems',
        lectureCount: 1,
        lectures: [
          {
            name: 'Lecture 1',
            folderName: 'lect-1',
            fileName: 'lecture-1',
            metadata: {
              datePublished: '2026-07-17'
            }
          }
        ]
      }
    ]
  })),
}));

vi.mock('../src/utils/blogLoader', () => ({
  getPublishedPosts: vi.fn(async () => [
    {
      slug: 'kimi-k3-a-justified-price-jump',
      frontmatter: {
        title: 'Kimi K3: A Justified Price Jump',
        description: 'Test description',
        publishedAt: '2026-07-17',
        draft: false,
      },
      html: '<p>test</p>',
    }
  ]),
  getPostBySlug: vi.fn(async (slug: string) => {
    if (slug === 'kimi-k3-a-justified-price-jump') {
      return {
        slug: 'kimi-k3-a-justified-price-jump',
        frontmatter: {
          title: 'Kimi K3: A Justified Price Jump',
          description: 'Test description',
          publishedAt: '2026-07-17',
          draft: false,
        },
        html: '<p>test</p>',
      };
    }
    return undefined;
  }),
}));

import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { GET as adminGet } from '../src/pages/api/admin/comments/index';
import { POST as adminPost } from '../src/pages/api/admin/comments/[id]';
import { GET as adminViewsGet } from '../src/pages/api/admin/views';
import { GET as adminOverviewGet } from '../src/pages/api/admin/comments/overview';
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

describe('GET /api/admin/views', () => {
  it('rejects anonymous (401)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/views' });
    const res = await adminViewsGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin (403)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/views', user: { id: 'u2' } });
    const res = await adminViewsGet(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns sorted views list for admin', async () => {
    await addAdmin(db, 'u1');
    // Insert mock views row into db
    await db.prepare('INSERT OR IGNORE INTO page_views (page_key, views) VALUES (?, ?)').bind('home', 50).run();
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/views', user: { id: 'u1' } });
    const res = await adminViewsGet(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.views).toBeDefined();
    // home should have 50 views
    const homeView = data.views.find((v: any) => v.pageKey === 'home');
    expect(homeView).toBeDefined();
    expect(homeView.views).toBe(50);
  });
});

describe('GET /api/admin/comments/overview', () => {
  it('rejects anonymous (401)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments/overview' });
    const res = await adminOverviewGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin (403)', async () => {
    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments/overview', user: { id: 'u2' } });
    const res = await adminOverviewGet(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns grouped comments for admin', async () => {
    await addAdmin(db, 'u1');
    // Create a comment
    await createComment(db, {
      pageType: 'lecture',
      subject: 'OperatingSystems',
      lecture: 'lect-1',
      displayName: 'Student A',
      body: 'Question on OS lecture',
      status: 'published',
    });

    const ctx = makeContext({ method: 'GET', url: BASE + '/api/admin/comments/overview', user: { id: 'u1' } });
    const res = await adminOverviewGet(ctx as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pages).toBeDefined();
    expect(data.pages.length).toBeGreaterThanOrEqual(1);

    const pageGroup = data.pages.find((p: any) => p.pageType === 'lecture' && p.subject === 'OperatingSystems');
    expect(pageGroup).toBeDefined();
    expect(pageGroup.total).toBe(1);
    expect(pageGroup.published).toBe(1);
    expect(pageGroup.comments[0].displayName).toBe('Student A');
    expect(pageGroup.comments[0].pageUrl).toBeDefined();
  });
});
