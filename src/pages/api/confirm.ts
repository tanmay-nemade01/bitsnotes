import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Legacy double opt-in confirmation links are no longer used.
 * Newsletter subscription now requires signing in with your account.
 */
export const GET: APIRoute = async ({ url }) => {
  const redirect = encodeURIComponent('/?newsletter_intent=1');
  return Response.redirect(`${url.origin}/auth/signin?redirect=${redirect}`, 302);
};
