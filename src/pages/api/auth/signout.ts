/**
 * POST /api/auth/signout
 * Clears session + refresh cookies, revokes refresh tokens, audit logs.
 *
 * Idempotent: always clears cookies, even when the session is already
 * expired/invalid, so a single click reliably logs the user out.
 */

import type { APIRoute } from 'astro';
import { getEnv, getClientIp } from '../../../lib/apiHelpers';
import {
  revokeAllRefreshTokens,
  clearSessionCookie,
  clearRefreshCookie,
  logAuthEvent,
  sha256Hex,
  getRefreshTokenFromCookie,
} from '../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = (context.locals as any).user;
  const ip = getClientIp(context.request);

  // CSRF: validate Origin/Referer
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  const db = env.DB;

  if (user) {
    try {
      await revokeAllRefreshTokens(db, user.id);
      await logAuthEvent(db, { userId: user.id, event: 'logout', ip, ua: context.request.headers.get('User-Agent') || '' });
    } catch (err) {
      console.error('Signout cleanup failed:', err);
      // Fall through — cookies must still be cleared below.
    }
  } else {
    // No valid session (e.g. access token expired and refresh invalid):
    // best-effort revoke so presented tokens can't be reused, then clear
    // cookies so the browser can't stay logged in.
    try {
      const cookieHeader = context.request.headers.get('Cookie');
      const refreshToken = getRefreshTokenFromCookie(cookieHeader);
      if (refreshToken && db) {
        const tokenHash = await sha256Hex(refreshToken);
        // Look up the owner so we can revoke ALL of their tokens
        // (full logout), not just the presented one.
        const row = await db.prepare(
          'SELECT user_id FROM refresh_tokens WHERE token_hash = ?',
        ).bind(tokenHash).first<{ user_id: string }>().catch(() => null);
        if (row?.user_id) {
          await revokeAllRefreshTokens(db, row.user_id).catch(() => {});
        } else {
          await db.prepare(
            'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
          ).bind(Date.now(), tokenHash).run().catch(() => {});
        }
      }
    } catch (err) {
      console.error('Signout best-effort revoke failed:', err);
    }
  }

  const headers = new Headers({
    Location: '/',
    'Cache-Control': 'no-store',
  });
  clearSessionCookie(headers, context.request);
  clearRefreshCookie(headers, context.request);

  return new Response(null, { status: 302, headers });
};
