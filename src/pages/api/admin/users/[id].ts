/**
 * Admin user mutation API — update individual user settings (access expiration, tags, chatbot limit).
 *
 * POST /api/admin/users/[id]
 *   body: {
 *     accessExpiresAt?: number | string | null,
 *     tags?: string,
 *     chatbotLimit?: number | null,
 *     resetChatbotUsage?: boolean
 *   }
 *   → { success: true, user: AdminUserView }
 *
 * Requires login + `admin_users` membership. Same-origin only (CSRF check).
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, badRequest, notFound, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import { findAdminUserById, updateUserAdminSettings } from '../../../../lib/users';
import { resetUserMonthlyUsage } from '../../../../lib/chatbotUsage';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  const isAdminUser = Boolean((context.locals as any).isAdmin) || (env.DB ? await isAdmin(env.DB, user.id) : false);
  if (!isAdminUser) return forbidden();

  if (!env.DB) {
    return serverError('Database unavailable.');
  }

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  const id = context.params.id;
  if (!id) return badRequest('Missing user id');

  let body: Record<string, unknown> = {};
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const existing = await findAdminUserById(env.DB, id);
  if (!existing) return notFound('User not found');

  const updates: { tags?: string; accessExpiresAt?: number | null; chatbotLimit?: number | null } = {};

  // Validate tags
  if (body.tags !== undefined) {
    if (typeof body.tags !== 'string') {
      return badRequest('Tags must be a string');
    }
    const cleanTag = body.tags.trim().slice(0, 60);
    if (!cleanTag) {
      return badRequest('Tag cannot be empty');
    }
    updates.tags = cleanTag;
  }

  // Validate accessExpiresAt
  if (body.accessExpiresAt !== undefined) {
    if (body.accessExpiresAt === null || body.accessExpiresAt === '') {
      updates.accessExpiresAt = null; // indefinite
    } else if (typeof body.accessExpiresAt === 'number') {
      if (!Number.isFinite(body.accessExpiresAt) || body.accessExpiresAt < 0) {
        return badRequest('Invalid access expiration timestamp');
      }
      updates.accessExpiresAt = Math.trunc(body.accessExpiresAt);
    } else if (typeof body.accessExpiresAt === 'string') {
      const parsedDate = new Date(body.accessExpiresAt).getTime();
      if (Number.isNaN(parsedDate)) {
        return badRequest('Invalid access expiration date format');
      }
      updates.accessExpiresAt = parsedDate;
    } else {
      return badRequest('Invalid accessExpiresAt parameter');
    }
  }

  // Validate chatbotLimit
  if (body.chatbotLimit !== undefined) {
    if (body.chatbotLimit === null || body.chatbotLimit === '') {
      updates.chatbotLimit = null; // Revert to default 20/month
    } else {
      const parsedLimit = typeof body.chatbotLimit === 'number' ? body.chatbotLimit : Number(body.chatbotLimit);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
        return badRequest('Chatbot limit must be a non-negative number');
      }
      updates.chatbotLimit = Math.trunc(parsedLimit);
    }
  }

  const shouldResetUsage = body.resetChatbotUsage === true;

  if (Object.keys(updates).length === 0 && !shouldResetUsage) {
    return badRequest('No updates provided');
  }

  try {
    if (shouldResetUsage) {
      await resetUserMonthlyUsage(env.DB, id);
    }

    const updated = Object.keys(updates).length > 0
      ? await updateUserAdminSettings(env.DB, id, updates)
      : await findAdminUserById(env.DB, id);

    if (!updated) return notFound('User not found');

    await logAuthEvent(env.DB, {
      userId: user.id,
      event: 'admin_user_update',
      ip: context.request.headers.get('CF-Connecting-IP') || '',
      ua: context.request.headers.get('User-Agent') || '',
    });

    return json({ success: true, user: updated, usageReset: shouldResetUsage }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error(`[api/admin/users/${id}] update failed:`, err);
    return serverError('Could not update user settings.');
  }
};
