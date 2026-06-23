/**
 * PUT /api/collections/rename
 * { collectionId, name }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString, validateFields, getClientIp } from '../../../lib/apiHelpers';
import { renameCollection } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);

  // CSRF: validate Origin/Referer
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['collectionId', 'name']);
  if (missing) return badRequest(missing);

  const name = sanitizeString(body.name, 80)!;
  if (name.length < 1) return badRequest('Name too short');

  const ok = await renameCollection(env.DB, user.id, body.collectionId as string, name);
  if (!ok) return badRequest('Collection not found');

  await logAuthEvent(env.DB, { userId: user.id, event: 'collection_rename', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
