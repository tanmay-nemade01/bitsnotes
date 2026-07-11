/**
 * POST /api/progress/mark-read
 * { subject, lecture, readPct }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, sanitizeString, getClientIp } from '../../../lib/apiHelpers';
import { markRead } from '../../../lib/progress';
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

  const missing = validateFields(body, ['subject', 'lecture']);
  if (missing) return badRequest(missing);

  if (typeof body.readPct !== 'number') {
    return badRequest('readPct must be a number');
  }

  await markRead(
    env.DB,
    user.id,
    sanitizeString(body.subject, 200)!,
    sanitizeString(body.lecture, 200)!,
    body.readPct,
  );

  await logAuthEvent(env.DB, { userId: user.id, event: 'progress_mark_read', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });

  return json({ success: true });
};
