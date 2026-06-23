/**
 * POST /api/collections/create
 * { name }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString, validateFields, getClientIp } from '../../../lib/apiHelpers';
import { createCollection } from '../../../lib/bookmarks';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['name']);
  if (missing) return badRequest(missing);

  const name = sanitizeString(body.name, 80)!;
  if (name.length < 1) return badRequest('Name too short');

  try {
    const collection = await createCollection(env.DB, user.id, name);
    await logAuthEvent(env.DB, { userId: user.id, event: 'collection_create', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });
    return json({ success: true, collection });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return badRequest('A collection with that name already exists');
    }
    return badRequest(err?.message || 'Failed to create collection');
  }
};
