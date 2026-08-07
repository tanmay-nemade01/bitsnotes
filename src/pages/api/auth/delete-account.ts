/**
 * POST /api/auth/delete-account
 * Permanently deletes the signed-in user's account and personal data (GDPR erasure).
 * Requires CSRF. Clears session cookies on success.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, unauthorized, json, serverError, getClientIp } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import {
  deleteUserAccount,
  revokeAllRefreshTokens,
  clearSessionCookie,
  clearRefreshCookie,
  logAuthEvent,
} from '../../../lib/auth';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const appEnv = await getEnv(context);
  if (!validateOrigin(context.request, appEnv.APP_BASE_URL)) {
    return csrfForbidden();
  }

  const contentType = context.request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    let body: Record<string, unknown> = {};
    try {
      body = await context.request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (body.confirm !== true && body.confirm !== 'DELETE') {
      return json({ error: 'Confirmation required. Send { "confirm": true }.' }, 400);
    }
  }

  try {
    await logAuthEvent(appEnv.DB, {
      userId: user.id,
      event: 'account_delete',
      ip: getClientIp(context.request),
      ua: context.request.headers.get('User-Agent') || '',
    });

    await revokeAllRefreshTokens(appEnv.DB, user.id);
    await deleteUserAccount(appEnv.DB, user.id);

    // Best-effort: remove newsletter KV entry
    try {
      const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;
      if (kv && user.email) {
        await kv.delete(`contact:${user.email.toLowerCase()}`);
      }
    } catch {
      // ignore
    }

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    clearSessionCookie(headers, context.request);
    clearRefreshCookie(headers, context.request);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error('[delete-account]', err);
    return serverError('Failed to delete account');
  }
};
