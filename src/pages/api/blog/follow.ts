import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { getFollowCount, getUserFollow, toggleFollow } from '../../../lib/blogInteractions';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const author = sanitizeString(context.url.searchParams.get('author'), 200);
  if (!author) return badRequest('Missing author');

  const env = await getEnv(context);
  const count = await getFollowCount(env.DB, author);
  const user = getUser(context);
  const following = user ? !!(await getUserFollow(env.DB, user.id, author)) : false;

  return json({ count, following });
};

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized('Sign in to follow authors');

  const env = await getEnv(context);
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const author = sanitizeString(body.author, 200);
  if (!author) return badRequest('Missing author');

  const result = await toggleFollow(env.DB, user.id, author);
  return json(result);
};
