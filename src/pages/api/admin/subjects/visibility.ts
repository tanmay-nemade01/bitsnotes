/**
 * Admin Subject Visibility API
 *
 * POST /api/admin/subjects/visibility
 * Body: { subjectName: string, isPublic: boolean }
 *
 * Toggles whether a subject and all its lectures are public or hidden.
 * Hidden subjects are only visible to admins for previewing.
 *
 * Requires login + admin_users check. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { setSubjectVisibility } from '../../../../lib/subjectVisibility';
import { listCatalog } from '../../../../utils/notesLoader';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request)) {
    return csrfForbidden();
  }

  try {
    const body = (await context.request.json()) as { subjectName?: string; isPublic?: boolean };
    const subjectName = typeof body.subjectName === 'string' ? body.subjectName.trim() : '';
    if (!subjectName) {
      return badRequest('subjectName is required.');
    }

    if (typeof body.isPublic !== 'boolean') {
      return badRequest('isPublic must be a boolean.');
    }

    // Verify subject exists in catalog
    const catalog = await listCatalog();
    const matched = catalog.find((c) => c.subject.toLowerCase() === subjectName.toLowerCase());
    const canonicalName = matched ? matched.subject : subjectName;

    const result = await setSubjectVisibility(env.DB, canonicalName, body.isPublic, user.id);

    return json({
      success: true,
      subjectName: result.subjectName,
      isPublic: result.isPublic,
    });
  } catch (err: any) {
    console.error('[admin/subjects/visibility] Error toggling visibility:', err.message);
    return serverError('Failed to update subject visibility.');
  }
};
