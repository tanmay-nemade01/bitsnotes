/**
 * Admin supporters API (Wall of Gratitude).
 *
 * GET  /api/admin/supporters  → { supporters, total }   (full roster, newest first)
 * POST /api/admin/supporters  → { supporter, total }    (add one)
 *
 * Requires login + `admin_users` membership. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import type { AuthDb } from '../../../../lib/auth/db';
import {
  addSupporter,
  countSupporters,
  DuplicateSupporterError,
  listSupporters,
  normalizeSupporterInput,
} from '../../../../lib/supporters';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  try {
    const supporters = await listSupporters(env.DB);
    const total = await countSupporters(env.DB);
    return json({ supporters, total }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[api/admin/supporters] list failed:', err);
    return serverError('Could not load supporters. Has migration 007 been applied?');
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

  let body: Record<string, unknown> = {};
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const parsed = normalizeSupporterInput(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const supporter = await addSupporter(env.DB, parsed.value, user.id);
    const total = await safeCount(env.DB);

    await logAuthEvent(env.DB, {
      userId: user.id,
      event: 'admin_supporter_add',
      ip: context.request.headers.get('CF-Connecting-IP') || '',
      ua: context.request.headers.get('User-Agent') || '',
    });

    return json({ supporter, total }, 201, { 'Cache-Control': 'no-store' });
  } catch (err) {
    if (err instanceof DuplicateSupporterError) return badRequest(err.message);
    console.error('[api/admin/supporters] add failed:', err);
    return serverError('Could not add supporter.');
  }
};

/** The count is cosmetic (header badge) — never fail the mutation over it. */
async function safeCount(db: AuthDb): Promise<number> {
  try {
    return await countSupporters(db);
  } catch {
    return 0;
  }
}
