/**
 * Admin Tags API: Seed from Catalog Metadata
 *
 * POST /api/admin/tags/seed
 *
 * Automatically inspects the current catalog and populates default tags and assignments.
 * Requires login + admin_users check. Same-origin only.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { seedTagsFromCatalog } from '../../../../lib/tags';
import { listCatalog } from '../../../../utils/notesLoader';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  try {
    const catalog = await listCatalog();
    const result = await seedTagsFromCatalog(
      env.DB,
      catalog.map((c) => ({
        subject: c.subject,
        semester: c.semester,
        order: c.order,
      }))
    );
    return json({ success: true, ...result }, 200, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    console.error('[api/admin/tags/seed] failed:', err);
    return serverError(`Could not seed tags: ${err.message}`);
  }
};
