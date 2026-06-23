/**
 * POST /api/bookmarks/add
 * { subject, lecture, displayName, collectionId? }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, sanitizeString } from '../../../lib/apiHelpers';
import { addBookmark } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';
import { getClientIp } from '../../../lib/apiHelpers';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['subject', 'lecture', 'displayName']);
  if (missing) return badRequest(missing);

  const subject = sanitizeString(body.subject, 200)!;
  const lecture = sanitizeString(body.lecture, 200)!;
  const displayName = sanitizeString(body.displayName, 200)!;
  const collectionId = typeof body.collectionId === 'string' ? body.collectionId : undefined;

  try {
    const bookmark = await addBookmark(env.DB, user.id, subject, lecture, displayName, collectionId);
    await logAuthEvent(env.DB, { userId: user.id, event: 'bookmark_add', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });
    return json({ success: true, bookmark });
  } catch (err: any) {
    // Unique constraint violation = already bookmarked
    if (err?.message?.includes('UNIQUE')) {
      return json({ success: true, message: 'Already bookmarked' });
    }
    return badRequest(err?.message || 'Failed to add bookmark');
  }
};
