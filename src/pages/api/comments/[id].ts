/**
 * DELETE /api/comments/[id]
 * Anonymous self-deletion via delete token (sent in body as `token`).
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, notFound, unauthorized } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { deleteCommentByToken } from '../../../lib/comments';

export const prerender = false;

export const DELETE: APIRoute = async (context) => {
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
    // token may also be passed as query for simplicity; fall through
  }
  const token = typeof body.token === 'string' ? body.token : null;
  if (!token) return unauthorized('Delete token required');

  const ok = await deleteCommentByToken(env.DB, id, token);
  if (!ok) return notFound('Comment not found or token invalid');

  return json({ success: true }, 200);
};
