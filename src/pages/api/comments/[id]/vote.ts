/**
 * POST /api/comments/[id]/vote
 * Reddit-style up/down vote. Toggling the same direction removes the vote.
 * Body: { value: 1 | -1 }
 * Identity: signed-in user id, else hashed visitor cookie (anon).
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, tooMany, serverError } from '../../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { getClientIp } from '../../../../lib/apiHelpers';
import { voteComment } from '../../../../lib/comments';
import { getVisitorId, hashVisitor } from '../../../../lib/visitor';
import { getUser } from '../../../../lib/apiHelpers';

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

  const value = body.value;
  if (value !== 1 && value !== -1) {
    return badRequest('value must be 1 or -1');
  }

  // Rate limit (reuse comment rate limiter, different key).
  if (env.COMMENT_RATE_LIMITER) {
    const ip = getClientIp(context.request);
    const { success } = await env.COMMENT_RATE_LIMITER.limit({ key: `v:${ip}` });
    if (!success) return tooMany('Too many requests. Please try again later.');
  }

  // Voter identity: signed-in user id, else hashed visitor cookie.
  const user = getUser(context);
  let voterHash: string;
  if (user) {
    voterHash = `u:${user.id}`;
  } else {
    const secret = (env as any).SESSION_SIGNING_KEY;
    if (!secret) return serverError('Server misconfigured');
    const visitorId = getVisitorId(context.request);
    voterHash = visitorId
      ? 'v:' + (await hashVisitor(visitorId, secret))
      : `anon:${getClientIp(context.request)}`;
  }

  try {
    const result = await voteComment(env.DB, id, voterHash, value as 1 | -1);
    if (!result) return badRequest('Comment not available');
    return json({ ok: true, score: result.score, myVote: result.myVote }, 200);
  } catch {
    return serverError('Failed to record vote');
  }
};
