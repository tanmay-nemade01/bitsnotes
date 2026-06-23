/**
 * PUT /api/bookmarks/move
 * { bookmarkId, collectionId }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, getClientIp } from '../../../lib/apiHelpers';
import { moveBookmark } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['bookmarkId', 'collectionId']);
  if (missing) return badRequest(missing);

  const ok = await moveBookmark(env.DB, user.id, body.bookmarkId as string, body.collectionId as string);
  if (!ok) return badRequest('Bookmark or collection not found');

  await logAuthEvent(env.DB, { userId: user.id, event: 'bookmark_move', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
