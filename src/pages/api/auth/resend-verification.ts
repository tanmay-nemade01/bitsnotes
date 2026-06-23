/**
 * POST /api/auth/resend-verification
 * Resend the verification email for a pending account.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, serverError, getClientIp, getUser } from '../../../lib/apiHelpers';
import {
  findUserByEmail, storeVerificationToken, logAuthEvent,
  sha256Hex, generateToken,
} from '../../../lib/auth';
import { sendVerificationEmail } from '../../../lib/auth/email';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  const ip = getClientIp(request);

  // CSRF: validate Origin/Referer
  if (!validateOrigin(request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!body.email || typeof body.email !== 'string') {
    return badRequest('Email required');
  }

  const db = env.DB;
  const { normalizeEmail } = await import('../../../lib/apiHelpers');
  const email = normalizeEmail(body.email);

  const user = await findUserByEmail(db, email);
  if (!user) {
    // Don't reveal whether user exists
    return json({ success: true, message: 'If your email is registered, a verification link has been sent.' });
  }

  if (user.status === 'active') {
    return json({ success: true, message: 'Email already verified.' });
  }

  // Rate limit: check last verification token (use expires_at as proxy for recency)
  const lastToken = await db.prepare(
    'SELECT expires_at FROM verification_tokens WHERE user_id = ? AND purpose = ? ORDER BY expires_at DESC LIMIT 1',
  ).bind(user.id, 'signup').first<{ expires_at: number }>();

  // The verification token expires_at is set to 24h from creation,
  // so if the most recent one was created less than 60s ago,
  // its expires_at will be within 24h - 60s of now.
  const lastCreatedEstimate = lastToken ? lastToken.expires_at - 24 * 60 * 60 * 1000 : 0;
  if (lastToken && Date.now() - lastCreatedEstimate < 60 * 1000) {
    return badRequest('Please wait before requesting another verification email.');
  }

  // Generate new token
  const token = generateToken(32);
  const tokenHash = await sha256Hex(token);
  await storeVerificationToken(db, user.id, tokenHash, 'signup', Date.now() + 24 * 60 * 60 * 1000);

  try {
    await sendVerificationEmail(env.SEND_EMAIL, email, token, env.APP_BASE_URL);
  } catch (err) {
    console.error('Failed to send verification email:', err);
    return serverError('Failed to send email. Please try again later.');
  }

  await logAuthEvent(db, { userId: user.id, event: 'verify_resend', ip, ua: request.headers.get('User-Agent') || '' });

  return json({ success: true, message: 'Verification email sent.' });
};
