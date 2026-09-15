/**
 * Admin supporters API — single supporter operations.
 *
 * POST /api/admin/supporters/[id]
 *   body: { action: 'update', ...fields }  → update name/tier/message/etc.
 *   body: { action: 'delete' }             → remove from the wall
 *
 * Requires login + `admin_users` membership. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, notFound, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import {
  DuplicateSupporterError,
  deleteSupporter,
  getSupporterById,
  normalizeSupporterInput,
  updateSupporter,
} from '../../../../lib/supporters';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing supporter id');

  let body: Record<string, unknown> = {};
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const action = typeof body.action === 'string' ? body.action : 'delete';
  if (action !== 'delete' && action !== 'update') return badRequest('Invalid action');

  const existing = await getSupporterById(env.DB, id);
  if (!existing) return notFound('Supporter not found');

  try {
    if (action === 'delete') {
      const ok = await deleteSupporter(env.DB, id);
      if (!ok) return notFound('Supporter not found');

      await logAuthEvent(env.DB, {
        userId: user.id,
        event: 'admin_supporter_delete',
        ip: context.request.headers.get('CF-Connecting-IP') || '',
        ua: context.request.headers.get('User-Agent') || '',
      });

      return json({ success: true, id }, 200, { 'Cache-Control': 'no-store' });
    }

    // Update: re-validate the full record so partial payloads can't blank fields.
    const parsed = normalizeSupporterInput({ ...body, name: body.name ?? existing.name });
    if (!parsed.ok) return badRequest(parsed.error);

    const updated = await updateSupporter(env.DB, id, parsed.value);
    if (!updated) return notFound('Supporter not found');

    await logAuthEvent(env.DB, {
      userId: user.id,
      event: 'admin_supporter_update',
      ip: context.request.headers.get('CF-Connecting-IP') || '',
      ua: context.request.headers.get('User-Agent') || '',
    });

    return json({ supporter: updated }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    if (err instanceof DuplicateSupporterError) return badRequest(err.message);
    console.error('[api/admin/supporters/[id]] failed:', err);
    return serverError('Could not update supporter.');
  }
};
