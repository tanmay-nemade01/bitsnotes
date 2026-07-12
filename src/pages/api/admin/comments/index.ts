/**
 * GET /api/admin/comments
 * List comments for moderation. Requires login + admin_users membership.
 * Query: filter = pending | reported | hidden | published | all
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, forbidden, badRequest } from '../../../../lib/apiHelpers';
import { getUser } from '../../../../lib/apiHelpers';
import { isAdmin, listAdminComments } from '../../../../lib/comments';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  const url = new URL(context.request.url);
  const filter = url.searchParams.get('filter') || 'all';
  const allowed = new Set(['all', 'pending', 'hidden', 'published']);
  if (!allowed.has(filter)) return badRequest('Invalid filter');

  const rows = await listAdminComments(env.DB, filter as any);
  // For "reported", surface those with report_count > 0.
  const out = filter === 'reported' ? rows.filter((r) => r.reportCount > 0) : rows;
  return json({ comments: out }, 200, { 'Cache-Control': 'no-store' });
};
