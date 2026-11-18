/**
 * Admin Lecture Visibility API
 *
 * POST /api/admin/subjects/lectures/visibility
 * Body: { subjectName: string, lectureFolder: string, isPublic: boolean }
 *
 * Toggles whether a single lecture (within a subject) is public or hidden.
 * Hidden lectures are only visible to admins for previewing.
 *
 * Requires login + admin_users check. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../../lib/apiHelpers';
import { isAdmin } from '../../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../../lib/auth/csrf';
import { setLectureVisibility } from '../../../../../lib/lectureVisibility';
import { listCatalog } from '../../../../../utils/notesLoader';

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
    const body = (await context.request.json()) as {
      subjectName?: string;
      lectureFolder?: string;
      isPublic?: boolean;
    };
    const subjectName = typeof body.subjectName === 'string' ? body.subjectName.trim() : '';
    const lectureFolder = typeof body.lectureFolder === 'string' ? body.lectureFolder.trim() : '';
    if (!subjectName) return badRequest('subjectName is required.');
    if (!lectureFolder) return badRequest('lectureFolder is required.');

    if (typeof body.isPublic !== 'boolean') {
      return badRequest('isPublic must be a boolean.');
    }

    // Verify the subject/lecture exists in the catalog (case-insensitive).
    const catalog = await listCatalog();
    const subject = catalog.find((c) => c.subject.toLowerCase() === subjectName.toLowerCase());
    if (!subject) return badRequest('Subject not found in catalog.');
    const lecture = subject.lectures.find(
      (l) => l.folderName === lectureFolder || l.folderName.toLowerCase() === lectureFolder.toLowerCase(),
    );
    if (!lecture) return badRequest('Lecture not found in subject.');

    const result = await setLectureVisibility(
      env.DB,
      subject.subject,
      lecture.folderName,
      body.isPublic,
      user.id,
    );

    return json({
      success: true,
      subjectName: result.subjectName,
      lectureFolder: result.lectureFolder,
      isPublic: result.isPublic,
    });
  } catch (err: any) {
    console.error('[admin/subjects/lectures/visibility] Error toggling lecture visibility:', err.message);
    return serverError('Failed to update lecture visibility.');
  }
};
