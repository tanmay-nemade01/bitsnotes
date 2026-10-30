/**
 * POST /api/auth/link-backup
 * Generates Google OAuth authorize URL to link a backup Google account.
 */

import type { APIRoute } from 'astro';
import { getEnv, getUser, json, badRequest, unauthorized, forbidden } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import {
  findUserById,
  generateCodeVerifier,
  generateCodeChallenge,
  encodeOAuthState,
  oauthStateCookie,
  googleAuthorizeUrl,
} from '../../../lib/auth';
import { isBackupEmailEligible } from '../../../lib/auth/backupEmail';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;

  // 1. validateOrigin
  if (!validateOrigin(request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  // 2. getUser
  const sessionUser = getUser(context);
  if (!sessionUser) {
    return unauthorized();
  }

  // 3. Load row with findUserById. Require row.status === 'active'
  const row = await findUserById(env.DB, sessionUser.id);
  if (!row || row.status !== 'active') {
    return unauthorized();
  }

  // 4. Require isBackupEmailEligible(row.email)
  if (!isBackupEmailEligible(row.email)) {
    return forbidden('Backup email is not available for this account.');
  }

  // 5. Require row.backup_email_verified_at == null
  if (row.backup_email_verified_at != null) {
    return badRequest('A backup Google account is already linked and cannot be changed.');
  }

  // 6. Build PKCE, state, payload
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = `google_${crypto.randomUUID()}`;

  const payload = {
    state,
    codeVerifier,
    provider: 'google' as const,
    redirect: '/account',
    intent: 'link_backup' as const,
    linkUserId: row.id,
    issuedAt: Date.now(),
  };

  const stateToken = await encodeOAuthState(payload, env.SESSION_SIGNING_KEY);

  // 7. Return json({ url }) with state cookie
  const redirectUri = `${env.APP_BASE_URL}/api/auth/callback/google`;
  const url = googleAuthorizeUrl(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri },
    state,
    codeChallenge,
    'select_account consent',
  );

  return json({ url }, 200, {
    'Set-Cookie': oauthStateCookie(stateToken, request),
  });
};

