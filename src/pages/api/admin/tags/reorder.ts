/**
 * Admin Tags API: Reorder Tag Sections
 *
 * POST /api/admin/tags/reorder  (body: { orderedIds: string[] })
 *
 * Sets the display_order of tags in the given sequence.
 * Requires login + admin_users check. Same-origin only.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { reorderTags, listTags } from '../../../../lib/tags';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  let body: Record<string, any> = {};
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const orderedIds = body.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
    return badRequest('orderedIds must be an array of tag IDs');
  }

  try {
    await reorderTags(env.DB, orderedIds);
    const tags = await listTags(env.DB, { includeHidden: true });
    return json({ success: true, tags }, 200, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    console.error('[api/admin/tags/reorder] failed:', err);
    return serverError(`Could not reorder tags: ${err.message}`);
  }
};
