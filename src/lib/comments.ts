/**
 * Comments data-access layer (Phase 6: Reddit-style threaded comments).
 *
 * All queries are parameterized. Comments are soft-deleted (status='deleted',
 * deleted_at set) — never hard-deleted — so reports/audit history is retained.
 *
 * Threading model: every comment has an optional `parent_id`. Top-level
 * comments have parent_id = NULL and depth = 0. Replies nest under a parent
 * and inherit depth = parent.depth + 1 (capped at MAX_DEPTH). The public API
 * returns a flat list with `parentId`/`depth` so the client can build the tree.
 */

import type { AuthDb } from './auth/db';
import { uuidv7, sha256Hex } from './auth/crypto';

export type CommentStatus = 'published' | 'pending' | 'hidden' | 'deleted';
export type PageType = 'lecture' | 'subject' | 'blog';

/** Maximum visual nesting depth. Deeper replies are flattened to this level. */
export const MAX_DEPTH = 6;

export interface CommentRow {
  id: string;
  page_type: PageType;
  subject: string;
  lecture: string | null;
  parent_id: string | null;
  depth: number;
  display_name: string;
  body: string;
  status: CommentStatus;
  moderation_reason: string | null;
  author_token_hash: string;
  author_user_id: string | null;
  author_email_hash: string | null;
  score: number;
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
  parentId: string | null;
  depth: number;
  displayName: string;
  body: string;
  score: number;
  isOwn: boolean;
  isAdmin: boolean;
  createdAt: number;
}

export interface ListResult {
  comments: PublicComment[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

function toPublic(row: CommentRow, opts?: { isOwn?: boolean; isAdmin?: boolean }): PublicComment {
  return {
    id: row.id,
    pageType: row.page_type,
    subject: row.subject,
    lecture: row.lecture,
    parentId: row.parent_id,
    depth: row.depth,
    displayName: row.display_name,
    body: row.body,
    score: row.score,
    isOwn: opts?.isOwn ?? false,
    isAdmin: opts?.isAdmin ?? false,
    createdAt: row.created_at,
  };
}

/**
 * Insert a new comment. Returns the raw delete token (shown once) + public row.
 *
 * For replies, pass `parentId` (and the resolved `depth`). For signed-in
 * authors, pass `authorUserId` + `authorEmailHash` so we can track identity
 * without exposing the email publicly. Anonymous authors get a delete token.
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
    parentId?: string | null;
    depth?: number;
    authorUserId?: string | null;
    authorEmailHash?: string | null;
  },
): Promise<{ token: string; comment: PublicComment }> {
  const id = uuidv7();
  const now = Date.now();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const tokenHash = await sha256Hex(token);
  const parentId = input.parentId ?? null;
  const depth = Math.min(input.depth ?? 0, MAX_DEPTH);

  await db.prepare(
    `INSERT INTO comments
      (id, page_type, subject, lecture, parent_id, depth, display_name, body, status, moderation_reason,
       author_token_hash, author_user_id, author_email_hash, score, report_count, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)`,
  )
    .bind(
      id,
      input.pageType,
      input.subject,
      input.lecture,
      parentId,
      depth,
      input.displayName,
      input.body,
      input.status,
      input.moderationReason ?? null,
      tokenHash,
      input.authorUserId ?? null,
      input.authorEmailHash ?? null,
      now,
      now,
    )
    .run();

  const row = await getCommentById(db, id);
  if (!row) throw new Error('Failed to read created comment');
  const isUserAdmin = input.authorUserId ? await isAdmin(db, input.authorUserId) : false;
  return { token, comment: toPublic(row, { isAdmin: isUserAdmin }) };
}

export async function getCommentById(db: AuthDb, id: string): Promise<CommentRow | null> {
  return db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<CommentRow>();
}

/**
 * List published comments for a page, cursor-paginated on (created_at, id).
 * `cursor` is a base64 of `${created_at}:${id}`.
 *
 * `voterHash` (optional) marks which comments the current viewer "owns"
 * (anonymous delete token stored locally, or signed-in user id) so the UI can
 * show delete controls. We compute ownership client-side via the stored token
 * for anon users; for signed-in users we pass their id to flag ownership.
 */
export async function listComments(
  db: AuthDb,
  opts: {
    pageType: PageType;
    subject: string;
    lecture: string | null;
    cursor?: string | null;
    limit?: number;
    ownIds?: Set<string> | null;
  },
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

  const adminIds = new Set<string>();
  const userIds = Array.from(new Set(page.map((r) => r.author_user_id).filter(Boolean)));
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(', ');
    const adminRows = await db.prepare(
      `SELECT user_id FROM admin_users WHERE user_id IN (${placeholders})`
    ).bind(...userIds).all<{ user_id: string }>();
    if (adminRows.results) {
      for (const r of adminRows.results) {
        adminIds.add(r.user_id);
      }
    }
  }

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? btoa(`${last.created_at}:${last.id}`) : null;

  return {
    comments: page.map((r) => toPublic(r, {
      isOwn: opts.ownIds ? opts.ownIds.has(r.id) : false,
      isAdmin: r.author_user_id ? adminIds.has(r.author_user_id) : false
    })),
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
 * Resolve a parent comment for a reply. Returns the parent row (must be a
 * published, non-deleted comment on the same page) or null. Also returns the
 * depth to assign the new reply (parent.depth + 1, capped at MAX_DEPTH).
 */
export async function resolveParent(
  db: AuthDb,
  parentId: string,
  page: { pageType: PageType; subject: string; lecture: string | null },
): Promise<{ parent: CommentRow; depth: number } | null> {
  const parent = await getCommentById(db, parentId);
  if (!parent || parent.status === 'deleted') return null;
  if (
    parent.page_type !== page.pageType ||
    parent.subject !== page.subject ||
    (parent.lecture ?? null) !== (page.lecture ?? null)
  ) {
    return null;
  }
  return { parent, depth: Math.min((parent.depth ?? 0) + 1, MAX_DEPTH) };
}

export interface VoteResult {
  ok: boolean;
  score: number;
  myVote: number; // 1 | -1 | 0 (current state after toggle)
}

/**
 * Apply (or toggle) an up/down vote on a comment. `voterHash` uniquely
 * identifies the voter (hashed visitor id for anon, or user id when signed in).
 * Voting again with the same value removes the vote (toggle). Returns the new
 * net score and the voter's resulting vote state.
 */
export async function voteComment(
  db: AuthDb,
  commentId: string,
  voterHash: string,
  value: 1 | -1,
): Promise<VoteResult | null> {
  const row = await getCommentById(db, commentId);
  if (!row || row.status === 'deleted') return null;

  const existing = await db.prepare(
    'SELECT id, value FROM comment_votes WHERE comment_id = ? AND voter_hash = ?',
  )
    .bind(commentId, voterHash)
    .first<{ id: string; value: number }>();

  const now = Date.now();
  let delta = 0;
  let myVote: number;

  if (!existing) {
    await db.prepare(
      'INSERT INTO comment_votes (id, comment_id, voter_hash, value, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(uuidv7(), commentId, voterHash, value, now)
      .run();
    delta = value;
    myVote = value;
  } else if (existing.value === value) {
    // Same vote again → toggle off.
    await db.prepare('DELETE FROM comment_votes WHERE id = ?').bind(existing.id).run();
    delta = -value;
    myVote = 0;
  } else {
    // Switch direction.
    await db.prepare('UPDATE comment_votes SET value = ?, created_at = ? WHERE id = ?')
      .bind(value, now, existing.id)
      .run();
    delta = value * 2;
    myVote = value;
  }

  const res = await db.prepare(
    'UPDATE comments SET score = score + ?, updated_at = ? WHERE id = ? RETURNING score',
  )
    .bind(delta, now, commentId)
    .first<{ score: number }>();

  return { ok: true, score: res?.score ?? row.score + delta, myVote };
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
  authorUserId: string | null;
}

export async function listAdminComments(
  db: AuthDb,
  filter: CommentStatus | 'all',
): Promise<AdminCommentView[]> {
  const clause = filter === 'all' ? '' : 'WHERE status = ?';
  const rows = await db.prepare(
    `SELECT id, page_type, subject, lecture, parent_id, depth, display_name, body, status, moderation_reason, author_user_id, score, report_count, created_at, updated_at
     FROM comments ${clause} ORDER BY created_at DESC`,
  )
    .bind(...(filter === 'all' ? [] : [filter]))
    .all<CommentRow>();

  const items = rows.results ?? [];
  const adminIds = new Set<string>();
  const userIds = Array.from(new Set(items.map((r) => r.author_user_id).filter(Boolean)));
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(', ');
    const adminRows = await db.prepare(
      `SELECT user_id FROM admin_users WHERE user_id IN (${placeholders})`
    ).bind(...userIds).all<{ user_id: string }>();
    if (adminRows.results) {
      for (const r of adminRows.results) {
        adminIds.add(r.user_id);
      }
    }
  }

  return items.map((r) => {
    const isUserAdmin = r.author_user_id ? adminIds.has(r.author_user_id) : false;
    return {
      ...toPublic(r, { isAdmin: isUserAdmin }),
      status: r.status,
      moderationReason: r.moderation_reason,
      reportCount: r.report_count,
      updatedAt: r.updated_at,
      authorUserId: r.author_user_id,
    };
  });
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
