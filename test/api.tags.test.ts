import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { setTestEnv } from './cloudflare-shim';
import { GET as tagsGet, POST as tagsPost } from '../src/pages/api/admin/tags/index';
import { POST as tagSinglePost, DELETE as tagSingleDelete } from '../src/pages/api/admin/tags/[id]';
import { POST as tagsReorderPost } from '../src/pages/api/admin/tags/reorder';
import { POST as subjectsPost, PUT as subjectsPut } from '../src/pages/api/admin/tags/subjects';
import { POST as seedPost } from '../src/pages/api/admin/tags/seed';

vi.mock('../src/utils/notesLoader', () => ({
  listCatalog: vi.fn(async () => [
    {
      subject: 'Machine Learning',
      shortName: 'ML',
      lectureCount: 4,
      semester: 1,
      order: 1,
      lectures: [{ scope: 'lecture' }],
    },
    {
      subject: 'Computer Vision',
      shortName: 'CV',
      lectureCount: 11,
      semester: 2,
      order: 11,
      lectures: [{ scope: 'lecture' }],
    },
    {
      subject: 'Untagged Elective',
      shortName: 'UE',
      lectureCount: 2,
      order: 999,
      lectures: [{ scope: 'lecture' }],
    },
  ]),
}));

const BASE = 'https://bitsnotes.com';

function makeContext(opts: {
  url?: string;
  method?: string;
  params?: Record<string, string>;
  user?: { id: string; email: string } | null;
  body?: any;
  headers?: Record<string, string>;
}): any {
  const url = opts.url || `${BASE}/api/admin/tags`;
  const method = opts.method || 'GET';
  const headers = new Headers({
    Origin: BASE,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  });

  const request = new Request(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  return {
    request,
    params: opts.params || {},
    locals: {
      user: opts.user !== undefined ? opts.user : { id: 'admin-user-1', email: 'admin@bitsnotes.com' },
    },
    url: new URL(url),
  };
}

describe('Admin Tags API Endpoints', () => {
  let db: AuthDb;

  beforeEach(async () => {
    db = makeDb();
    setTestEnv({
      DB: db,
      APP_BASE_URL: BASE,
    });

    // Make 'admin-user-1' an admin in DB
    await db.prepare('INSERT INTO admin_users (user_id, created_at) VALUES (?, ?)').bind('admin-user-1', Date.now()).run();
  });

  it('rejects unauthenticated requests or non-admin users with 401/403', async () => {
    // Unauthenticated
    const ctxNoAuth = makeContext({ user: null });
    const resNoAuth = await tagsGet(ctxNoAuth);
    expect(resNoAuth.status).toBe(401);

    // Authenticated but not an admin
    const ctxNonAdmin = makeContext({ user: { id: 'regular-user', email: 'regular@bitsnotes.com' } });
    const resNonAdmin = await tagsGet(ctxNonAdmin);
    expect(resNonAdmin.status).toBe(403);
  });

  it('GET /api/admin/tags lists tags, untagged counts, and catalog subjects', async () => {
    const ctx = makeContext({});
    const res = await tagsGet(ctx);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.tags)).toBe(true);
    expect(Array.isArray(data.allSubjects)).toBe(true);
    expect(data.allSubjects.length).toBe(3);
    expect(data.untaggedCount).toBe(3); // None tagged initially
  });

  it('POST /api/admin/tags creates a new tag', async () => {
    const ctx = makeContext({
      method: 'POST',
      body: {
        name: 'Featured Subjects',
        slug: 'featured-subjects',
        description: 'Top picks for semester',
        color: 'amber',
        displayOrder: 0,
        isVisible: true,
      },
    });

    const res = await tagsPost(ctx);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tag.name).toBe('Featured Subjects');
    expect(data.tag.color).toBe('amber');
  });

  it('POST /api/admin/tags/[id] updates tag and deletes tag', async () => {
    // Create tag first
    const createRes = await tagsPost(
      makeContext({
        method: 'POST',
        body: { name: 'To Be Modified', color: 'blue' },
      })
    );
    const { tag } = await createRes.json();

    // Update
    const updateCtx = makeContext({
      method: 'POST',
      params: { id: tag.id },
      body: {
        action: 'update',
        name: 'Modified Tag Name',
        color: 'rose',
      },
    });
    const updateRes = await tagSinglePost(updateCtx);
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.tag.name).toBe('Modified Tag Name');
    expect(updateData.tag.color).toBe('rose');

    // Delete
    const deleteCtx = makeContext({
      method: 'DELETE',
      params: { id: tag.id },
    });
    const deleteRes = await tagSingleDelete(deleteCtx);
    expect(deleteRes.status).toBe(200);
    const deleteData = await deleteRes.json();
    expect(deleteData.success).toBe(true);
  });

  it('POST /api/admin/tags/reorder reorders tags', async () => {
    const t1 = await (await tagsPost(makeContext({ method: 'POST', body: { name: 'Tag 1' } }))).json();
    const t2 = await (await tagsPost(makeContext({ method: 'POST', body: { name: 'Tag 2' } }))).json();

    const reorderCtx = makeContext({
      method: 'POST',
      body: { orderedIds: [t2.tag.id, t1.tag.id] },
    });
    const reorderRes = await tagsReorderPost(reorderCtx);
    expect(reorderRes.status).toBe(200);
    const reorderData = await reorderRes.json();
    expect(reorderData.tags[0].id).toBe(t2.tag.id);
  });

  it('POST /api/admin/tags/subjects assigns tags to subject and PUT reorders within tag', async () => {
    const t1 = await (await tagsPost(makeContext({ method: 'POST', body: { name: 'Sem 1' } }))).json();
    const t2 = await (await tagsPost(makeContext({ method: 'POST', body: { name: 'Featured' } }))).json();

    // Assign both tags to 'Machine Learning'
    const assignCtx = makeContext({
      method: 'POST',
      body: {
        subjectName: 'Machine Learning',
        tagIds: [t1.tag.id, t2.tag.id],
      },
    });
    const assignRes = await subjectsPost(assignCtx);
    expect(assignRes.status).toBe(200);
    const assignData = await assignRes.json();
    expect(assignData.tags.length).toBe(2);

    // Reorder subjects within tag t1
    const reorderSubCtx = makeContext({
      method: 'PUT',
      body: {
        tagId: t1.tag.id,
        orderedSubjectNames: ['Machine Learning'],
      },
    });
    const reorderSubRes = await subjectsPut(reorderSubCtx);
    expect(reorderSubRes.status).toBe(200);
  });

  it('POST /api/admin/tags/seed seeds defaults from catalog', async () => {
    const ctx = makeContext({ method: 'POST' });
    const res = await seedPost(ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.tagsCreated).toBeGreaterThanOrEqual(1);
    expect(data.assignmentsCreated).toBeGreaterThanOrEqual(1);
  });
});
