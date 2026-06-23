/**
 * POST /api/auth/signout
 * Clears session + refresh cookies, revokes refresh tokens, audit logs.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, getClientIp } from '../../../lib/apiHelpers';
import {
  revokeAllRefreshTokens,
  clearSessionCookie,
  clearRefreshCookie,
  logAuthEvent,
} from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = (context.locals as any).user;
  const ip = getClientIp(context.request);

  if (!user) {
    return unauthorized();
  }

  const db = env.DB;
  await revokeAllRefreshTokens(db, user.id);
  await logAuthEvent(db, { userId: user.id, event: 'logout', ip, ua: context.request.headers.get('User-Agent') || '' });

  const headers = new Headers({
    Location: '/',
    'Cache-Control': 'no-store',
  });
  clearSessionCookie(headers);
  clearRefreshCookie(headers);

  return new Response(null, { status: 302, headers });
};
