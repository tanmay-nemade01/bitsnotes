/**
 * GET /api/auth/callback/:provider
 * OAuth callback: verify state, exchange code, upsert user+identity, set session.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, serverError, getClientIp, normalizeEmail } from '../../../../lib/apiHelpers';
import {
  findIdentity, findUserByEmail, createUser, createIdentity, verifyUserEmail,
  storeVerificationToken, signJwt, createRefreshToken,
  setSessionCookie, setRefreshCookie, clearOAuthStateCookie,
  logAuthEvent, sha256Hex, generateToken,
  getEntitlement,
  type OAuthProfile,
} from '../../../../lib/auth';
import { sendVerificationEmail } from '../../../../lib/auth/email';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = getEnv(context);
  const request = context.request;
  const url = new URL(request.url);
  const ip = getClientIp(request);

  // Extract provider from path
  const pathParts = url.pathname.split('/');
  const provider = pathParts[pathParts.length - 1]; // 'google' or 'github'

  if (provider !== 'google' && provider !== 'github') {
    return badRequest('Unknown provider');
  }

  // Verify state
  const cookieHeader = request.headers.get('Cookie');
  const stateCookie = cookieHeader?.match(/__oauth_state=([^;]+)/)?.[1];
  if (!stateCookie) {
    return badRequest('Missing state cookie — please try signing in again.');
  }

  // Decode state cookie
  let stateData: { state: string; codeVerifier: string; provider: string };
  try {
    stateData = JSON.parse(atob(stateCookie));
  } catch {
    return badRequest('Invalid state cookie');
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code || !returnedState) {
    return badRequest('Missing code or state parameter');
  }

  if (returnedState !== stateData.state) {
    const loggingDb = (context.locals as any).runtime?.env?.DB;
    if (loggingDb) {
      await logAuthEvent(loggingDb, { event: 'state_mismatch', ip, ua: request.headers.get('User-Agent') || '' });
    }
    return badRequest('State mismatch — possible CSRF attack. Please try again.');
  }

  if (stateData.provider !== provider) {
    return badRequest('Provider mismatch');
  }

  // Exchange code for profile
  let profile: OAuthProfile;
  try {
    const redirectUri = `${env.APP_BASE_URL}/api/auth/callback/${provider}`;
    const baseConfig = {
      clientId: provider === 'google' ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID,
      clientSecret: provider === 'google' ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET,
      redirectUri,
    };

    if (provider === 'google') {
      const { googleExchangeCode } = await import('../../../../lib/auth/oauth');
      profile = await googleExchangeCode(baseConfig, code, stateData.codeVerifier);
    } else {
      const { githubExchangeCode } = await import('../../../../lib/auth/oauth');
      profile = await githubExchangeCode(baseConfig, code, stateData.codeVerifier);
    }
  } catch (err) {
    console.error(`OAuth exchange failed for ${provider}:`, err);
    return serverError(`Failed to authenticate with ${provider}`);
  }

  const db = env.DB;
  const normalizedEmail = normalizeEmail(profile.email);

  // Upsert user + identity
  let user: { id: string; status: string };
  let isNewUser = false;

  const existingIdentity = await findIdentity(db, provider, profile.providerUid);
  if (existingIdentity) {
    // Existing user — find by id
    const { findUserById } = await import('../../../../lib/auth/db');
    user = (await findUserById(db, existingIdentity.user_id))!;
  } else {
    // Check if email already exists (different provider)
    const existingUser = await findUserByEmail(db, normalizedEmail);
    if (existingUser) {
      // Link new provider to existing user
      await createIdentity(db, existingUser.id, provider, profile.providerUid);
      user = existingUser;
    } else {
      // Brand new user
      const newUser = await createUser(db, {
        email: normalizedEmail,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      });
      user = newUser;
      isNewUser = true;
    }
  }

  // Handle email verification
  if (isNewUser && !profile.emailVerified) {
    // Send our own verification email
    const token = generateToken(32);
    const tokenHash = await sha256Hex(token);
    await storeVerificationToken(db, user.id, tokenHash, 'signup', Date.now() + 24 * 60 * 60 * 1000);

    try {
      await sendVerificationEmail(env.SEND_EMAIL, normalizedEmail, token, env.APP_BASE_URL);
    } catch (err) {
      console.error('Failed to send verification email:', err);
      // Don't block signup — they can resend later
    }

    await logAuthEvent(db, { userId: user.id, event: 'signup', provider, ip, ua: request.headers.get('User-Agent') || '' });

    // Redirect to "check your email" page
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: '/auth/verify-email?pending=1',
        ...getRedirectHeaders(),
      },
    });
    clearOAuthStateCookie(response.headers);
    return response;
  }

  // User is verified (or provider said email is verified) — check status
  if (user.status === 'pending') {
    // Provider said verified but our DB still says pending — activate them
    if (profile.emailVerified) {
      await verifyUserEmail(db, user.id);
      user.status = 'active';
    } else {
      // Can't sign in without verification
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: '/auth/verify-email?pending=1',
          ...getRedirectHeaders(),
        },
      });
      clearOAuthStateCookie(response.headers);
      return response;
    }
  }

  if (user.status !== 'active') {
    return badRequest(`Account status: ${user.status}. Please contact support.`);
  }

  // Create session
  const entitlement = await getEntitlement(db, user.id);
  const tier = entitlement?.tier ?? 'free';
  const { token: newRefreshToken, tokenHash: rtHash } = await createRefreshToken(db, user.id);

  const accessToken = await signJwt(
    { sub: user.id, email: normalizedEmail, tier, rt: rtHash },
    env.SESSION_SIGNING_KEY,
  );

  await logAuthEvent(db, { userId: user.id, event: 'login', provider, ip, ua: request.headers.get('User-Agent') || '' });

  // Redirect to homepage with session cookies
  const headers = new Headers({
    Location: '/',
    'Cache-Control': 'no-store',
  });
  setSessionCookie(headers, accessToken);
  setRefreshCookie(headers, newRefreshToken);
  clearOAuthStateCookie(headers);

  return new Response(null, { status: 302, headers });
};

function getRedirectHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store' };
}
