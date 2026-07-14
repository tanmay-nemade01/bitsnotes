/**
 * GET /api/auth/verify-email?token=...
 * Consumes a verification token, activates the user account.
 */

import type { APIRoute } from 'astro';
import { getEnv, badRequest, getClientIp } from '../../../lib/apiHelpers';
import { consumeVerificationToken, verifyUserEmail, logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const ip = getClientIp(request);

  if (!token) {
    return badRequest('Missing token parameter');
  }

  const db = env.DB;

  // Hash the token and look it up
  const { sha256Hex } = await import('../../../lib/auth/crypto');
  const tokenHash = await sha256Hex(token);

  const result = await consumeVerificationToken(db, tokenHash, 'signup');

  if (!result) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/auth/verify-email?error=invalid' },
    });
  }

  // Activate the user
  await verifyUserEmail(db, result.userId);
  await logAuthEvent(db, { userId: result.userId, event: 'verify', ip, ua: request.headers.get('User-Agent') || '' });

  return new Response(null, {
    status: 302,
    headers: { Location: '/auth/verify-email?ok=1' },
  });
};
