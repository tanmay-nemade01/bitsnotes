/**
 * Admin Tags API: Subject-Tag Assignments & Ranking
 *
 * POST /api/admin/tags/subjects  (body: { subjectName: string, tagIds: string[] })
 *   → Assigns multiple tags to a folder/subject.
 *
 * PUT  /api/admin/tags/subjects  (body: { tagId: string, orderedSubjectNames: string[] })
 *   → Reorders subjects within a specific tag section.
 *
 * Requires login + admin_users check. Same-origin only.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { setSubjectTags, getTagsForSubject, reorderSubjectsInTag } from '../../../../lib/tags';

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

  const { subjectName, tagIds } = body;
  if (!subjectName || typeof subjectName !== 'string') {
    return badRequest('subjectName is required');
  }
  if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'string')) {
    return badRequest('tagIds must be an array of tag IDs');
  }

  try {
    await setSubjectTags(env.DB, subjectName, tagIds);
    const updatedTags = await getTagsForSubject(env.DB, subjectName);
    return json({ success: true, subjectName, tags: updatedTags }, 200, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    console.error('[api/admin/tags/subjects] POST failed:', err);
    return serverError(`Could not assign tags: ${err.message}`);
  }
};

export const PUT: APIRoute = async (context) => {
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

  const { tagId, orderedSubjectNames } = body;
  if (!tagId || typeof tagId !== 'string') {
    return badRequest('tagId is required');
  }
  if (!Array.isArray(orderedSubjectNames) || orderedSubjectNames.some((n) => typeof n !== 'string')) {
    return badRequest('orderedSubjectNames must be an array of subject names');
  }

  try {
    await reorderSubjectsInTag(env.DB, tagId, orderedSubjectNames);
    return json({ success: true, tagId }, 200, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    console.error('[api/admin/tags/subjects] PUT failed:', err);
    return serverError(`Could not reorder subjects: ${err.message}`);
  }
};
