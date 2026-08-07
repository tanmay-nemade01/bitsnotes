/**
 * POST /api/comments/[id]/report
 * Report a comment (anonymous). Deduplicated by reporter hash (visitor cookie).
 */
import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, tooMany } from '../../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { getClientIp } from '../../../../lib/apiHelpers';
import { reportComment } from '../../../../lib/comments';
import { getVisitorId, hashVisitor } from '../../../../lib/visitor';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);

  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing comment id');

  let body: Record<string, unknown> = {};
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON');
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 100) : 'spam';
  if (!['spam', 'abuse', 'offtopic', 'other'].includes(reason)) {
    return badRequest('Invalid reason');
  }

  // Rate limit (reuse comment rate limiter, different key).
  if (env.COMMENT_RATE_LIMITER) {
    const ip = getClientIp(context.request);
    const { success } = await env.COMMENT_RATE_LIMITER.limit({ key: `r:${ip}` });
    if (!success) return tooMany('Too many requests. Please try again later.');
  }

  // Build reporter hash from visitor cookie so duplicates are caught.
  const secret = (env as any).SESSION_SIGNING_KEY;
  if (!secret) return json({ error: 'Server misconfigured' }, 500);
  const visitorId = getVisitorId(context.request);
  const reporterHash = visitorId
    ? await hashVisitor(visitorId, secret)
    : `anon:${getClientIp(context.request)}`;

  try {
    const result = await reportComment(env.DB, id, reporterHash, reason);
    if (result.alreadyReported) {
      return json({ ok: true, alreadyReported: true }, 200);
    }
    return json({ ok: true, hidden: result.hidden ?? false }, 200);
  } catch {
    return json({ error: 'Failed to report comment' }, 500);
  }
};
