/**
 * Comments data-access layer (Phase 4: Anonymous comments).
 *
 * All queries are parameterized. Comments are soft-deleted (status='deleted',
 * deleted_at set) — never hard-deleted — so reports/audit history is retained.
 */

import type { AuthDb } from './auth/db';
import { uuidv7, sha256Hex } from './auth/crypto';

export type CommentStatus = 'published' | 'pending' | 'hidden' | 'deleted';
export type PageType = 'lecture' | 'subject';

export interface CommentRow {
  id: string;
  page_type: PageType;
  subject: string;
  lecture: string | null;
  display_name: string;
  body: string;
  status: CommentStatus;
  moderation_reason: string | null;
  author_token_hash: string;
  report_count: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface PublicComment {
  id: string;
  pageType: PageType;
  subject: string;
  lecture: string | null;
  displayName: string;
  body: string;
  createdAt: number;
}

export interface ListResult {
  comments: PublicComment[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

function toPublic(row: CommentRow): PublicComment {
  return {
    id: row.id,
    pageType: row.page_type,
    subject: row.subject,
    lecture: row.lecture,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * Insert a new comment. Returns the raw delete token (shown once) + public row.
 */
export async function createComment(
  db: AuthDb,
  input: {
    pageType: PageType;
    subject: string;
    lecture: string | null;
    displayName: string;
    body: string;
    status: CommentStatus;
    moderationReason?: string | null;
  },
): Promise<{ token: string; comment: PublicComment }> {
  const id = uuidv7();
  const now = Date.now();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const tokenHash = await sha256Hex(token);

  await db.prepare(
    `INSERT INTO comments
      (id, page_type, subject, lecture, display_name, body, status, moderation_reason, author_token_hash, report_count, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
  )
    .bind(
      id,
      input.pageType,
      input.subject,
      input.lecture,
      input.displayName,
      input.body,
      input.status,
      input.moderationReason ?? null,
      tokenHash,
      now,
      now,
    )
    .run();

  const row = await getCommentById(db, id);
  if (!row) throw new Error('Failed to read created comment');
  return { token, comment: toPublic(row) };
}

export async function getCommentById(db: AuthDb, id: string): Promise<CommentRow | null> {
  return db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<CommentRow>();
}

/**
 * List published comments for a page, cursor-paginated on (created_at, id).
 * `cursor` is a base64 of `${created_at}:${id}`.
 */
export async function listComments(
  db: AuthDb,
  opts: { pageType: PageType; subject: string; lecture: string | null; cursor?: string | null; limit?: number },
): Promise<ListResult> {
  const limit = Math.min(opts.limit ?? PAGE_SIZE, PAGE_SIZE);
  const lec = opts.lecture ?? null;
  const params: unknown[] = [opts.pageType, opts.subject, lec, lec, lec];
  let cursorClause = '';
  if (opts.cursor) {
    try {
      const decoded = atob(opts.cursor);
      const [createdAt, id] = decoded.split(':');
      // Rows strictly older than the cursor (DESC created_at, then id).
      cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      params.push(Number(createdAt), Number(createdAt), id);
    } catch {
      // ignore malformed cursor
    }
  }

  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM comments
     WHERE page_type = ? AND subject = ? AND (lecture IS ? AND ? IS NULL OR lecture = ?) AND status = 'published'`,
  )
    .bind(opts.pageType, opts.subject, lec, lec, lec)
    .first<{ c: number }>();

  const rows = await db.prepare(
    `SELECT * FROM comments
     WHERE page_type = ? AND subject = ? AND (lecture IS ? AND ? IS NULL OR lecture = ?) AND status = 'published'
     ${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  )
    .bind(...params, limit + 1)
    .all<CommentRow>();

  const items = rows.results ?? [];
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? btoa(`${last.created_at}:${last.id}`) : null;

  return {
    comments: page.map(toPublic),
    total: totalRow?.c ?? 0,
    nextCursor,
    hasMore,
  };
}

/**
 * Self-delete via token. Verifies SHA-256 of the provided token against the
 * stored hash, then soft-deletes. Returns true on success.
 */
export async function deleteCommentByToken(db: AuthDb, id: string, token: string): Promise<boolean> {
  const row = await getCommentById(db, id);
  if (!row || row.status === 'deleted') return false;
  const hash = await sha256Hex(token);
  if (hash !== row.author_token_hash) return false;

  await db.prepare(
    "UPDATE comments SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(Date.now(), Date.now(), id)
    .run();
  return true;
}

/**
 * Report a comment. Deduplicates by (comment_id, reporter_hash).
 * Auto-hides when report_count >= 3.
 */
export async function reportComment(
  db: AuthDb,
  commentId: string,
  reporterHash: string,
  reason: string,
): Promise<{ ok: boolean; alreadyReported?: boolean; hidden?: boolean }> {
  const existing = await db.prepare(
    'SELECT id FROM comment_reports WHERE comment_id = ? AND reporter_hash = ?',
  )
    .bind(commentId, reporterHash)
    .first();
  if (existing) return { ok: false, alreadyReported: true };

  const id = uuidv7();
  const now = Date.now();
  await db.prepare(
    'INSERT INTO comment_reports (id, comment_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, commentId, reporterHash, reason, now)
    .run();

  const res = await db.prepare(
    'UPDATE comments SET report_count = report_count + 1, updated_at = ? WHERE id = ? RETURNING report_count',
  )
    .bind(now, commentId)
    .first<{ report_count: number }>();

  const hidden = (res?.report_count ?? 0) >= 3;
  if (hidden) {
    await db.prepare(
      "UPDATE comments SET status = 'hidden', moderation_reason = 'auto-hidden: reports >= 3', updated_at = ? WHERE id = ?",
    )
      .bind(now, commentId)
      .run();
  }
  return { ok: true, hidden };
}

// ─── Admin helpers ─────────────────────────────────────────────────────────

export interface AdminCommentView extends PublicComment {
  status: CommentStatus;
  moderationReason: string | null;
  reportCount: number;
  updatedAt: number;
}

export async function listAdminComments(
  db: AuthDb,
  filter: CommentStatus | 'all',
): Promise<AdminCommentView[]> {
  const clause = filter === 'all' ? '' : 'WHERE status = ?';
  const rows = await db.prepare(
    `SELECT id, page_type, subject, lecture, display_name, body, status, moderation_reason, report_count, created_at, updated_at
     FROM comments ${clause} ORDER BY created_at DESC`,
  )
    .bind(...(filter === 'all' ? [] : [filter]))
    .all<CommentRow>();
  return (rows.results ?? []).map((r) => ({
    ...toPublic(r),
    status: r.status,
    moderationReason: r.moderation_reason,
    reportCount: r.report_count,
    updatedAt: r.updated_at,
  }));
}

export async function setCommentStatus(
  db: AuthDb,
  id: string,
  status: CommentStatus,
  reason?: string | null,
): Promise<boolean> {
  const res = await db.prepare(
    "UPDATE comments SET status = ?, moderation_reason = ?, updated_at = ? WHERE id = ?",
  )
    .bind(status, reason ?? null, Date.now(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ─── Admin allowlist ───────────────────────────────────────────────────────

export async function isAdmin(db: AuthDb, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM admin_users WHERE user_id = ?')
    .bind(userId)
    .first();
  return !!row;
}

export async function addAdmin(db: AuthDb, userId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO admin_users (user_id, created_at) VALUES (?, ?)')
    .bind(userId, Date.now())
    .run();
}
