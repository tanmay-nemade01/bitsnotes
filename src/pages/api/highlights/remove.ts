/**
 * POST /api/highlights/remove
 * { highlightId }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, getClientIp } from '../../../lib/apiHelpers';
import { removeHighlight } from '../../../lib/highlights';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['highlightId']);
  if (missing) return badRequest(missing);

  await removeHighlight(env.DB, user.id, body.highlightId as string);
  await logAuthEvent(env.DB, { userId: user.id, event: 'highlight_remove', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
