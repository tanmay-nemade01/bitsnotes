/**
 * Admin Tags API: Single Tag Operations (Update & Delete)
 *
 * POST   /api/admin/tags/[id]  (body: { action: 'update' | 'delete', ...fields })
 * DELETE /api/admin/tags/[id]
 * PATCH  /api/admin/tags/[id]
 *
 * Requires login + admin_users check. Same-origin only.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, notFound, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { updateTag, deleteTag } from '../../../../lib/tags';

export const prerender = false;

async function handleUpdate(env: any, id: string, body: Record<string, any>) {
  const updated = await updateTag(env.DB, id, {
    name: body.name,
    slug: body.slug,
    description: body.description,
    color: body.color,
    displayOrder: body.displayOrder,
    isVisible: body.isVisible,
  });
  if (!updated) return notFound('Tag not found');
  return json({ tag: updated }, 200, { 'Cache-Control': 'no-store' });
}

async function handleDelete(env: any, id: string) {
  const ok = await deleteTag(env.DB, id);
  if (!ok) return notFound('Tag not found');
  return json({ success: true, id }, 200, { 'Cache-Control': 'no-store' });
}

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing tag id');

  let body: Record<string, any> = {};
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const action = body.action || 'update';
  try {
    if (action === 'delete') {
      return await handleDelete(env, id);
    }
    return await handleUpdate(env, id, body);
  } catch (err: any) {
    console.error('[api/admin/tags/[id]] failed:', err);
    return badRequest(err.message || 'Operation failed.');
  }
};

export const DELETE: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing tag id');

  try {
    return await handleDelete(env, id);
  } catch (err: any) {
    console.error('[api/admin/tags/[id]] DELETE failed:', err);
    return serverError(err.message || 'Could not delete tag.');
  }
};

export const PATCH: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing tag id');

  let body: Record<string, any> = {};
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  try {
    return await handleUpdate(env, id, body);
  } catch (err: any) {
    console.error('[api/admin/tags/[id]] PATCH failed:', err);
    return badRequest(err.message || 'Could not update tag.');
  }
};
