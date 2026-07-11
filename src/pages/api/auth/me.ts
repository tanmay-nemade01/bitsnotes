/**
 * GET /api/auth/me
 * Returns current user info from session cookie, or 401 if not authenticated.
 * Used by client-side Navbar to refresh UI after OAuth redirect.
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/apiHelpers';
import { getSessionTokenFromCookie, verifyJwt } from '../../../lib/auth/session';
import { findUserById } from '../../../lib/auth/db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const env = await getEnv();
  const cookieHeader = request.headers.get('Cookie');
  const sessionToken = getSessionTokenFromCookie(cookieHeader);
  const signingKey = env.SESSION_SIGNING_KEY || '';

  if (!sessionToken || !signingKey) {
    return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const claims = await verifyJwt(sessionToken, signingKey);
  if (!claims) {
    return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const dbUser = await findUserById(db, claims.sub);
  if (!dbUser || dbUser.status !== 'active') {
    return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const user = {
    id: dbUser.id,
    email: dbUser.email,
    displayName: dbUser.display_name,
    avatarUrl: dbUser.avatar_url,
  };

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
