/**
 * POST /api/admin/comments/[id]
 * Moderate a comment: publish | hide | delete | restore.
 * Requires login + admin_users membership. Logs the action.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, forbidden, badRequest } from '../../../../lib/apiHelpers';
import { getUser } from '../../../../lib/apiHelpers';
import { isAdmin, setCommentStatus, getCommentById } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';

export const prerender = false;

const ACTIONS: Record<string, any> = {
  publish: { status: 'published', event: 'admin_comment_publish' },
  hide: { status: 'hidden', event: 'admin_comment_hide' },
  delete: { status: 'deleted', event: 'admin_comment_delete' },
  restore: { status: 'published', event: 'admin_comment_restore' },
};

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  const id = context.params.id;
  if (!id) return badRequest('Missing comment id');

  let body: Record<string, unknown> = {};
  try { body = await context.request.json(); } catch {}
  const action = typeof body.action === 'string' ? body.action : '';
  const def = ACTIONS[action];
  if (!def) return badRequest('Invalid action');

  const existing = await getCommentById(env.DB, id);
  if (!existing) return badRequest('Comment not found');

  const ok = await setCommentStatus(env.DB, id, def.status, typeof body.reason === 'string' ? body.reason.slice(0, 200) : null);
  if (!ok) return badRequest('Comment not found');

  await logAuthEvent(env.DB, {
    userId: user.id,
    event: def.event,
    ip: context.request.headers.get('CF-Connecting-IP') || '',
    ua: context.request.headers.get('User-Agent') || '',
  });

  return json({ success: true, status: def.status }, 200, { 'Cache-Control': 'no-store' });
};
