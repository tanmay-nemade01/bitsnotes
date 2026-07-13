/**
 * GET /api/auth/me
 * Returns current user info from session cookie, or 401 if not authenticated.
 * Used by client-side Navbar to refresh UI after OAuth redirect.
 *
 * Uses the middleware-resolved `locals.user` which already handles refresh
 * token rotation, so sessions persist for the full 30-day refresh token
 * lifetime — not just the 15-minute access token window.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user;

  if (!user) {
    return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  return new Response(JSON.stringify({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
