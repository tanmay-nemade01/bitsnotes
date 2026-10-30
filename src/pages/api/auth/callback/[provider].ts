/**
 * GET /api/auth/callback/:provider
 * OAuth callback: verify state, exchange code, upsert user+identity, set session.
 */

import type { APIRoute } from 'astro';
import { getEnv, badRequest, serverError, getClientIp, normalizeEmail } from '../../../../lib/apiHelpers';
import {
  findIdentity,
  findUserByEmail,
  createUser,
  createIdentity,
  verifyUserEmail,
  signJwt,
  createRefreshToken,
  setSessionCookie,
  setRefreshCookie,
  clearOAuthStateCookie,
  logAuthEvent,
  hmacVerify,
  getEntitlement,
  findUserByBackupEmail,
  decodeOAuthState,
  safeRedirectPath,
  type OAuthProfile,
} from '../../../../lib/auth';
import { resetUnverifiedAccountLinks } from '../../../../lib/auth/db';
import { handleBackupLink } from '../../../../lib/auth/backupLink';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  const url = new URL(request.url);
  const ip = getClientIp(request);

  // Extract provider from path
  const pathParts = url.pathname.split('/');
  const provider = pathParts[pathParts.length - 1]; // 'google' or 'github'

  if (provider !== 'google' && provider !== 'github') {
    return badRequest('Unknown provider');
  }

  // Verify state — cookie is signed: base64(payload).base64url(hmac)
  const cookieHeader = request.headers.get('Cookie');
  const stateCookie = cookieHeader?.match(/(?:^|;\s*)__oauth_state=([^;]+)/)?.[1];
  if (!stateCookie) {
    return badRequest('Missing state cookie — please try signing in again.');
  }

  const stateData = await decodeOAuthState(stateCookie, env.SESSION_SIGNING_KEY);
  if (!stateData) {
    const dotIdx = stateCookie.lastIndexOf('.');
    if (dotIdx !== -1) {
      const payloadB64 = stateCookie.slice(0, dotIdx);
      const sig = stateCookie.slice(dotIdx + 1);
      const valid = await hmacVerify(env.SESSION_SIGNING_KEY, payloadB64, sig);
      if (!valid) {
        const loggingDb = env.DB;
        if (loggingDb) {
          await logAuthEvent(loggingDb, {
            event: 'state_cookie_tampered',
            ip,
            ua: request.headers.get('User-Agent') || '',
          });
        }
        return badRequest('State cookie tampered — please try signing in again.');
      }
    }
    return badRequest('State cookie invalid or expired — please try signing in again.');
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code || !returnedState) {
    return badRequest('Missing code or state parameter');
  }

  if (returnedState !== stateData.state) {
    const loggingDb = env.DB;
    if (loggingDb) {
      await logAuthEvent(loggingDb, {
        event: 'state_mismatch',
        ip,
        ua: request.headers.get('User-Agent') || '',
      });
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

  // Handle backup account linking
  if (stateData.intent === 'link_backup') {
    return handleBackupLink({ db, env, request, profile, stateData, ip });
  }

  // Login flow
  const normalizedEmail = normalizeEmail(profile.email);

  const existingIdentity = await findIdentity(db, provider, profile.providerUid);
  let user: { id: string; status: string; email: string };

  if (existingIdentity) {
    const { findUserById } = await import('../../../../lib/auth/db');
    const existing = await findUserById(db, existingIdentity.user_id);
    if (!existing) {
      return badRequest('User account not found');
    }
    user = existing;
    if (user.status === 'pending') {
      if (profile.emailVerified && normalizedEmail === user.email) {
        await verifyUserEmail(db, user.id);
        user.status = 'active';
      } else {
        const response = new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?pending=1',
            'Cache-Control': 'no-store',
          },
        });
        clearOAuthStateCookie(response.headers, request);
        return response;
      }
    }
  } else {
    if (!profile.emailVerified) {
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: '/auth/verify-email?pending=1',
          'Cache-Control': 'no-store',
        },
      });
      clearOAuthStateCookie(response.headers, request);
      return response;
    }

    const backupOwner = await findUserByBackupEmail(db, normalizedEmail);
    if (backupOwner && backupOwner.status === 'active') {
      await createIdentity(db, backupOwner.id, provider, profile.providerUid);
      user = backupOwner;
      await logAuthEvent(db, {
        userId: backupOwner.id,
        event: 'backup_email_login',
        provider,
        ip,
        ua: request.headers.get('User-Agent') || '',
      });
    } else {
      const existing = await findUserByEmail(db, normalizedEmail);
      if (existing) {
        if (existing.status === 'pending') {
          await resetUnverifiedAccountLinks(db, existing.id);
          await verifyUserEmail(db, existing.id);
          existing.status = 'active';
          await createIdentity(db, existing.id, provider, profile.providerUid);
          user = existing;
        } else {
          await createIdentity(db, existing.id, provider, profile.providerUid);
          user = existing;
        }
      } else {
        const newUser = await createUser(db, {
          email: normalizedEmail,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        });
        await createIdentity(db, newUser.id, provider, profile.providerUid);
        await verifyUserEmail(db, newUser.id);
        newUser.status = 'active';
        user = newUser;
        await logAuthEvent(db, {
          userId: user.id,
          event: 'signup',
          provider,
          ip,
          ua: request.headers.get('User-Agent') || '',
        });
      }
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
    { sub: user.id, email: user.email, tier, rt: rtHash },
    env.SESSION_SIGNING_KEY,
  );

  await logAuthEvent(db, {
    userId: user.id,
    event: 'login',
    provider,
    ip,
    ua: request.headers.get('User-Agent') || '',
  });

  // Redirect with session cookies
  const postAuthRedirect = safeRedirectPath(stateData.redirect, env.APP_BASE_URL) ?? '/';
  const headers = new Headers({
    Location: postAuthRedirect,
    'Cache-Control': 'no-store',
  });
  setSessionCookie(headers, accessToken, request);
  setRefreshCookie(headers, newRefreshToken, request);
  clearOAuthStateCookie(headers, request);

  return new Response(null, { status: 302, headers });
};
