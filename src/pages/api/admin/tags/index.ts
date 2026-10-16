/**
 * Admin Tags API: List & Create Tags
 *
 * GET  /api/admin/tags  → { tags, subjectTagsMap, allSubjects, untaggedSubjects }
 * POST /api/admin/tags  → { tag } (create new tag)
 *
 * Requires login + admin_users check. Same-origin only on mutations.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { listTags, createTag, listSubjectTagsMap } from '../../../../lib/tags';
import { listCatalog } from '../../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  try {
    const tags = await listTags(env.DB, { includeHidden: true });
    const subjectTagsMap = await listSubjectTagsMap(env.DB);
    const catalog = await listCatalog();

    const allSubjects = catalog.map((c) => ({
      name: c.subject,
      shortName: c.shortName,
      lectureCount: c.lectureCount,
      semester: c.semester,
      order: c.order,
      tags: (subjectTagsMap.get(c.subject) || []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        slug: t.slug,
        displayOrder: t.displayOrder,
      })),
    }));

    const untaggedSubjects = allSubjects.filter((s) => s.tags.length === 0);

    // Convert map to plain object for JSON response
    const subjectTagsObj: Record<string, string[]> = {};
    for (const [sName, sTags] of subjectTagsMap.entries()) {
      subjectTagsObj[sName] = sTags.map((t) => t.id);
    }

    return json(
      {
        tags,
        subjectTagsMap: subjectTagsObj,
        allSubjects,
        untaggedCount: untaggedSubjects.length,
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (err: any) {
    console.error('[api/admin/tags] GET failed:', err);
    return serverError(`Could not load tags: ${err.message}`);
  }
};

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

  try {
    const tag = await createTag(env.DB, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      color: body.color,
      displayOrder: body.displayOrder,
      isVisible: body.isVisible,
    });
    return json({ tag }, 201, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    console.error('[api/admin/tags] POST failed:', err);
    return badRequest(err.message || 'Could not create tag.');
  }
};
