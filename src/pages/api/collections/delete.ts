/**
 * DELETE /api/collections/delete
 * { collectionId }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, getClientIp } from '../../../lib/apiHelpers';
import { deleteCollection } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['collectionId']);
  if (missing) return badRequest(missing);

  await deleteCollection(env.DB, user.id, body.collectionId as string);
  await logAuthEvent(env.DB, { userId: user.id, event: 'collection_delete', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
