/**
 * Admin Auto-Hide New Lectures API
 *
 * POST /api/admin/subjects/auto-hide
 * Body: { subjectName: string, enabled: boolean }
 *
 * Controls whether new lectures added to a subject are hidden by default.
 * The subject itself and lectures that are already public stay public.
 *
 * Before flipping the setting, every existing lecture without an explicit
 * visibility row is snapshotted with its current effective visibility, so the
 * change only affects lectures added afterwards.
 *
 * Requires login + admin_users check. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import {
  listSubjectAutoHideMap,
  setSubjectAutoHide,
} from '../../../../lib/subjectVisibility';
import {
  seedLectureVisibilityDefaults,
  invalidateLectureVisibilityCache,
} from '../../../../lib/lectureVisibility';
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
    const body = (await context.request.json()) as { subjectName?: string; enabled?: boolean };
    const subjectName = typeof body.subjectName === 'string' ? body.subjectName.trim() : '';
    if (!subjectName) return badRequest('subjectName is required.');
    if (typeof body.enabled !== 'boolean') return badRequest('enabled must be a boolean.');

    const catalog = await listCatalog();
    const subject = catalog.find((c) => c.subject.toLowerCase() === subjectName.toLowerCase());
    if (!subject) return badRequest('Subject not found in catalog.');

    // Current setting determines how un-rowed lectures are currently treated:
    // auto-hide off => public, auto-hide on => hidden.
    const autoHideMap = await listSubjectAutoHideMap(env.DB);
    const currentlyEnabled = autoHideMap.get(subject.subject) === true;

    const seeded = await seedLectureVisibilityDefaults(
      env.DB,
      subject.subject,
      subject.lectures.map((l) => ({ folderName: l.folderName })),
      !currentlyEnabled,
      user.id,
    );

    const result = await setSubjectAutoHide(env.DB, subject.subject, body.enabled, user.id);
    invalidateLectureVisibilityCache();

    return json({
      success: true,
      subjectName: result.subjectName,
      enabled: result.hideNewLectures,
      lecturesSnapshotted: seeded,
    });
  } catch (err: any) {
    console.error('[admin/subjects/auto-hide] Error updating auto-hide setting:', err.message);
    return serverError('Failed to update auto-hide setting.');
  }
};
