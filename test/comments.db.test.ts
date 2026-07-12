import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  createComment,
  listComments,
  deleteCommentByToken,
  reportComment,
  listAdminComments,
  setCommentStatus,
  isAdmin,
  addAdmin,
} from '../src/lib/comments';

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
});

describe('comments data layer', () => {
  it('creates a published comment and returns a one-time token', async () => {
    const { token, comment } = await createComment(db, {
      pageType: 'lecture',
      subject: 'NLP',
      lecture: 'Lecture_01',
      displayName: 'Ada',
      body: 'Great notes!',
      status: 'published',
    });
    expect(comment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(20);
    expect(comment.displayName).toBe('Ada');
    expect(comment.body).toBe('Great notes!');
  });

  it('lists only published comments, newest first', async () => {
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'first', status: 'published' });
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'B', body: 'second', status: 'published' });
    await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'C', body: 'hidden', status: 'hidden' });

    const res = await listComments(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1' });
    expect(res.comments).toHaveLength(2);
    expect(res.total).toBe(2);
    expect(res.comments[0].body).toBe('second'); // newest first
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it('paginates with cursor on (created_at, id)', async () => {
    for (let i = 0; i < 5; i++) {
      await createComment(db, { pageType: 'subject', subject: 'NLP', lecture: null, displayName: `U${i}`, body: `c${i}`, status: 'published' });
    }
    const page1 = await listComments(db, { pageType: 'subject', subject: 'NLP', lecture: null, limit: 2 });
    expect(page1.comments).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listComments(db, { pageType: 'subject', subject: 'NLP', lecture: null, limit: 2, cursor: page1.nextCursor! });
    expect(page2.comments).toHaveLength(2);
    // No overlap between pages.
    const ids1 = new Set(page1.comments.map((c) => c.id));
    expect(page2.comments.every((c) => !ids1.has(c.id))).toBe(true);
  });

  it('self-deletes via correct token (soft delete)', async () => {
    const { token, comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'published' });
    const ok = await deleteCommentByToken(db, comment.id, token);
    expect(ok).toBe(true);

    const res = await listComments(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1' });
    expect(res.comments).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  it('rejects self-delete with wrong token', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'published' });
    const ok = await deleteCommentByToken(db, comment.id, 'wrong-token');
    expect(ok).toBe(false);
  });

  it('rejects self-delete of already-deleted comment', async () => {
    const { token, comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'published' });
    await deleteCommentByToken(db, comment.id, token);
    const again = await deleteCommentByToken(db, comment.id, token);
    expect(again).toBe(false);
  });

  it('deduplicates reports and auto-hides at 3', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'published' });

    const r1 = await reportComment(db, comment.id, 'hash1', 'spam');
    expect(r1.ok).toBe(true);
    expect(r1.hidden).toBe(false);

    // Duplicate report from same reporter is ignored.
    const dup = await reportComment(db, comment.id, 'hash1', 'spam');
    expect(dup.ok).toBe(false);
    expect(dup.alreadyReported).toBe(true);

    await reportComment(db, comment.id, 'hash2', 'spam');
    const r3 = await reportComment(db, comment.id, 'hash3', 'spam');
    expect(r3.hidden).toBe(true);

    const res = await listComments(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1' });
    expect(res.comments).toHaveLength(0); // hidden => not listed
  });

  it('admin can filter and change status', async () => {
    const { comment } = await createComment(db, { pageType: 'lecture', subject: 'NLP', lecture: 'L1', displayName: 'A', body: 'x', status: 'pending' });
    const pending = await listAdminComments(db, 'pending');
    expect(pending).toHaveLength(1);

    const ok = await setCommentStatus(db, comment.id, 'published');
    expect(ok).toBe(true);
    const published = await listAdminComments(db, 'published');
    expect(published).toHaveLength(1);
  });

  it('admin allowlist membership', async () => {
    expect(await isAdmin(db, 'u1')).toBe(false);
    await addAdmin(db, 'u1');
    expect(await isAdmin(db, 'u1')).toBe(true);
  });
});
