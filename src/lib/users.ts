/**
 * Admin user directory — read models for the /backstage/users roster.
 *
 * Follows the same conventions as the rest of the data layer:
 *  - DB rows are snake_case (`AdminUserRow`).
 *  - The public/API shape is camelCase (`AdminUserView`).
 *  - All queries use parameterized prepared statements.
 *
 * The roster is read-only for now; mutation helpers (suspend, grant tier, …)
 * are intentionally left out so they can be added deliberately later.
 */

import type { AuthDb } from './auth/db';
import { getUserDefaultTag } from './auth/access';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Account lifecycle states mirrored from the `users.status` column. */
export const USER_STATUSES = ['active', 'pending', 'suspended', 'deleted'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
}

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
  email_verified_at: number | null;
  created_at: number;
  updated_at: number;
  tier: string | null;
  is_admin: number;
  providers: string | null;
  last_login_at: number | null;
  tags?: string | null;
  access_expires_at?: number | null;
  chatbot_limit?: number | null;
}

export interface AdminUserView {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  tier: string;
  isAdmin: boolean;
  tags: string;
  accessExpiresAt: number | null;
  isAccessExpired: boolean;
  chatbotLimit: number | null;
  /** OAuth providers linked to the account, e.g. ['google']. */
  providers: string[];
  /** Epoch ms — account creation time. */
  createdAt: number;
  /** Epoch ms — last row update. */
  updatedAt: number;
  /** Epoch ms — most recent successful sign-in, or null. */
  lastLoginAt: number | null;
}

export interface UserStats {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  deleted: number;
  /** Accounts created in the last 7 days. */
  newLast7Days: number;
  /** Accounts created in the last 30 days. */
  newLast30Days: number;
  /** Accounts on a paid tier. */
  paid: number;
  /** Members of the admin allowlist. */
  admins: number;
}

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
  /** Free-text match against email and display name. */
  search?: string;
  /** Exact account status; omit for every status. */
  status?: string;
  /** 'desc' = newest first (default), 'asc' = oldest first. */
  order?: 'asc' | 'desc';
}

export interface ListUsersResult {
  users: AdminUserView[];
  /** Total rows matching the filter (ignoring limit/offset). */
  total: number;
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 120;

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toPublic(row: AdminUserRow): AdminUserView {
  const accessExpiresAt = row.access_expires_at != null ? Number(row.access_expires_at) : null;
  const isAdmin = Number(row.is_admin) === 1;
  const isExpired = accessExpiresAt != null && Date.now() > accessExpiresAt && !isAdmin;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    status: row.status,
    emailVerified: row.email_verified_at != null,
    tags: row.tags || getUserDefaultTag(row.email),
    accessExpiresAt,
    isAccessExpired: isExpired,
    chatbotLimit: row.chatbot_limit !== undefined && row.chatbot_limit !== null ? Number(row.chatbot_limit) : null,
    tier: row.tier || 'free',
    isAdmin,
    providers: row.providers ? row.providers.split(',').filter(Boolean) : [],
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    lastLoginAt: row.last_login_at != null ? Number(row.last_login_at) : null,
  };
}

// ─── Query building ─────────────────────────────────────────────────────────

/** Escape LIKE wildcards so a literal `%` in the search box stays literal. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

function buildFilter(
  search: string | undefined,
  status: string | undefined,
): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];

  if (status) {
    parts.push('u.status = ?');
    params.push(status);
  }

  const term = (search || '').trim();
  if (term) {
    parts.push("(u.email LIKE ? ESCAPE '\\' OR IFNULL(u.display_name, '') LIKE ? ESCAPE '\\' OR IFNULL(u.tags, '') LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(term)}%`;
    params.push(like, like, like);
  }

  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

const SELECT_COLUMNS = `
  u.id,
  u.email,
  u.display_name,
  u.avatar_url,
  u.status,
  u.email_verified_at,
  u.created_at,
  u.updated_at,
  COALESCE(u.tags, 'normal') AS tags,
  u.access_expires_at,
  u.chatbot_limit,
  COALESCE(e.tier, 'free') AS tier,
  CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS is_admin,
  (SELECT GROUP_CONCAT(i.provider) FROM identities i WHERE i.user_id = u.id) AS providers,
  (SELECT MAX(ae.created_at) FROM auth_events ae WHERE ae.user_id = u.id AND ae.event = 'login') AS last_login_at
`;

const SELECT_COLUMNS_LEGACY = `
  u.id,
  u.email,
  u.display_name,
  u.avatar_url,
  u.status,
  u.email_verified_at,
  u.created_at,
  u.updated_at,
  COALESCE(u.tags, 'normal') AS tags,
  u.access_expires_at,
  NULL AS chatbot_limit,
  COALESCE(e.tier, 'free') AS tier,
  CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS is_admin,
  (SELECT GROUP_CONCAT(i.provider) FROM identities i WHERE i.user_id = u.id) AS providers,
  (SELECT MAX(ae.created_at) FROM auth_events ae WHERE ae.user_id = u.id AND ae.event = 'login') AS last_login_at
`;

const FROM_JOINS = `
  FROM users u
  LEFT JOIN entitlements e ON e.user_id = u.id
  LEFT JOIN admin_users a ON a.user_id = u.id
`;

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List users for the admin roster. Defaults to newest-first.
 */
export async function listAdminUsers(
  db: AuthDb,
  opts: ListUsersOptions = {},
): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const order = opts.order === 'asc' ? 'asc' : 'desc';
  const { clause, params } = buildFilter(opts.search, opts.status);

  const orderClause = order === 'asc'
    ? 'ORDER BY u.created_at ASC, u.id ASC'
    : 'ORDER BY u.created_at DESC, u.id DESC';

  let rows: { results?: AdminUserRow[] };
  try {
    rows = await db
      .prepare(`SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${clause} ${orderClause} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all<AdminUserRow>();
  } catch (err: any) {
    if (err?.message?.includes('chatbot_limit') || err?.message?.includes('no such column')) {
      rows = await db
        .prepare(`SELECT ${SELECT_COLUMNS_LEGACY} ${FROM_JOINS} ${clause} ${orderClause} LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset)
        .all<AdminUserRow>();
    } else {
      throw err;
    }
  }

  const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM users u ${clause}`);
  const countRow = await (params.length > 0 ? countStmt.bind(...params) : countStmt).first<{ count: number }>();

  return {
    users: (rows.results ?? []).map(toPublic),
    total: Number(countRow?.count) || 0,
  };
}

/**
 * Headline counters for the admin overview / users page.
 */
export async function getUserStats(db: AuthDb): Promise<UserStats> {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
       FROM users`,
    )
    .first<Record<string, number>>();

  const recent = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month
       FROM users`,
    )
    .bind(now - 7 * day, now - 30 * day)
    .first<Record<string, number>>();

  const paidRow = await db
    .prepare("SELECT COUNT(*) AS count FROM entitlements WHERE tier != 'free'")
    .first<{ count: number }>();

  const adminRow = await db
    .prepare('SELECT COUNT(*) AS count FROM admin_users')
    .first<{ count: number }>();

  return {
    total: Number(row?.total) || 0,
    active: Number(row?.active) || 0,
    pending: Number(row?.pending) || 0,
    suspended: Number(row?.suspended) || 0,
    deleted: Number(row?.deleted) || 0,
    newLast7Days: Number(recent?.week) || 0,
    newLast30Days: Number(recent?.month) || 0,
    paid: Number(paidRow?.count) || 0,
    admins: Number(adminRow?.count) || 0,
  };
}

/**
 * Fetch a single user view by id for admin endpoints.
 */
export async function findAdminUserById(db: AuthDb, userId: string): Promise<AdminUserView | null> {
  let row: AdminUserRow | null = null;
  try {
    row = await db
      .prepare(`SELECT ${SELECT_COLUMNS} ${FROM_JOINS} WHERE u.id = ?`)
      .bind(userId)
      .first<AdminUserRow>();
  } catch (err: any) {
    if (err?.message?.includes('chatbot_limit') || err?.message?.includes('no such column')) {
      row = await db
        .prepare(`SELECT ${SELECT_COLUMNS_LEGACY} ${FROM_JOINS} WHERE u.id = ?`)
        .bind(userId)
        .first<AdminUserRow>();
    } else {
      throw err;
    }
  }
  return row ? toPublic(row) : null;
}

/**
 * Update user settings (access expiry date and tags) from admin backstage.
 */
export async function updateUserAdminSettings(
  db: AuthDb,
  userId: string,
  updates: {
    tags?: string;
    accessExpiresAt?: number | null;
    chatbotLimit?: number | null;
  },
): Promise<AdminUserView | null> {
  const now = Date.now();
  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (updates.tags !== undefined) {
    setClauses.push('tags = ?');
    params.push(updates.tags);
  }
  if (updates.accessExpiresAt !== undefined) {
    setClauses.push('access_expires_at = ?');
    params.push(updates.accessExpiresAt);
  }
  if (updates.chatbotLimit !== undefined) {
    setClauses.push('chatbot_limit = ?');
    params.push(updates.chatbotLimit === null ? null : Math.max(0, Math.trunc(updates.chatbotLimit)));
  }

  params.push(userId);
  try {
    await db
      .prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();
  } catch (err: any) {
    if (err?.message?.includes('chatbot_limit') && updates.chatbotLimit !== undefined) {
      // Retry without chatbot_limit if column is not yet migrated
      const fallbackClauses: string[] = ['updated_at = ?'];
      const fallbackParams: unknown[] = [now];
      if (updates.tags !== undefined) {
        fallbackClauses.push('tags = ?');
        fallbackParams.push(updates.tags);
      }
      if (updates.accessExpiresAt !== undefined) {
        fallbackClauses.push('access_expires_at = ?');
        fallbackParams.push(updates.accessExpiresAt);
      }
      fallbackParams.push(userId);
      await db
        .prepare(`UPDATE users SET ${fallbackClauses.join(', ')} WHERE id = ?`)
        .bind(...fallbackParams)
        .run();
    } else {
      throw err;
    }
  }

  return findAdminUserById(db, userId);
}

