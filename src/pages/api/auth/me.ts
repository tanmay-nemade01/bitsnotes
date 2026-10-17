/**
 * GET /api/auth/me
 * Returns current user info from session cookie, or 401 if not authenticated.
 * Used by client-side Navbar to refresh UI after OAuth redirect.
 *
 * Uses the middleware-resolved `locals.user` which already handles refresh
 * token rotation, so sessions persist for the full 30-day refresh token
 * lifetime — not just the 15-minute access token window.
 *
 * `isAdmin` is included so the (signed-in, admin-only) entry link into the
 * admin area can be rendered without exposing it to regular users.
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/apiHelpers';
import { isAdmin } from '../../../lib/comments';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user;

  if (!user) {
    return new Response(JSON.stringify({ user: null, loggedIn: false }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  let admin = false;
  try {
    const env = await getEnv();
    if (env.DB) admin = await isAdmin(env.DB, user.id);
  } catch {
    // best-effort — never block the auth response on the admin lookup
  }

  return new Response(JSON.stringify({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      backupEmail: user.backupEmail ?? null,
      isAdmin: admin,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
