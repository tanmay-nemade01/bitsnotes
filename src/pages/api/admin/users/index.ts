/**
 * Admin users API — read-only roster for /backstage/users.
 *
 * GET /api/admin/users?limit=&offset=&search=&status=&order=
 *   → { users, total, limit, offset, stats }
 *
 * Requires login + `admin_users` membership. Read-only, so no CSRF check is
 * needed (the same-origin cookie alone can not mutate anything).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  getUserStats,
  isUserStatus,
  listAdminUsers,
} from '../../../../lib/users';

export const prerender = false;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  const params = new URL(context.request.url).searchParams;

  const limit = clampInt(params.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = clampInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const search = (params.get('search') || '').trim().slice(0, MAX_SEARCH_LENGTH);

  const statusParam = (params.get('status') || 'all').trim().toLowerCase();
  if (statusParam !== 'all' && !isUserStatus(statusParam)) {
    return badRequest(`Invalid status: ${statusParam}`);
  }
  const status = statusParam === 'all' ? undefined : statusParam;

  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  try {
    const [{ users, total }, stats] = await Promise.all([
      listAdminUsers(env.DB, { limit, offset, search, status, order }),
      getUserStats(env.DB),
    ]);

    await logAuthEvent(env.DB, {
      userId: user.id,
      event: 'admin_users_list',
      ip: context.request.headers.get('CF-Connecting-IP') || '',
      ua: context.request.headers.get('User-Agent') || '',
    });

    return json({ users, total, limit, offset, stats }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[api/admin/users] list failed:', err);
    return serverError('Could not load users.');
  }
};
