import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { getLikeCount, getUserLike, toggleLike } from '../../../lib/blogInteractions';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const slug = sanitizeString(context.url.searchParams.get('slug'), 200);
  if (!slug) return badRequest('Missing slug');

  const env = await getEnv(context);
  const count = await getLikeCount(env.DB, slug);
  const user = getUser(context);
  const liked = user ? !!(await getUserLike(env.DB, user.id, slug)) : false;

  return json({ count, liked });
};

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized('Sign in to like posts');

  const env = await getEnv(context);
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const slug = sanitizeString(body.slug, 200);
  if (!slug) return badRequest('Missing slug');

  const result = await toggleLike(env.DB, user.id, slug);
  return json(result);
};
