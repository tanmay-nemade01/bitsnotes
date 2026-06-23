/**
 * DELETE /api/bookmarks/remove
 * { subject, lecture }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, sanitizeString, getClientIp } from '../../../lib/apiHelpers';
import { removeBookmark } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['subject', 'lecture']);
  if (missing) return badRequest(missing);

  const subject = sanitizeString(body.subject, 200)!;
  const lecture = sanitizeString(body.lecture, 200)!;

  await removeBookmark(env.DB, user.id, subject, lecture);
  await logAuthEvent(env.DB, { userId: user.id, event: 'bookmark_remove', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
