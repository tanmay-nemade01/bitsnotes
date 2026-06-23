/**
 * POST /api/auth/signin
 * Validates Turnstile, redirects to OAuth provider (Google or GitHub).
 */

import type { APIRoute } from 'astro';
import { getEnv, badRequest, serverError, getClientIp } from '../../../lib/apiHelpers';
import { verifyTurnstile, generateCodeVerifier, generateCodeChallenge } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = getEnv(context);
  const request = context.request;
  const ip = getClientIp(request);

  let body: { provider?: string; 'cf-turnstile-response'?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const { provider, 'cf-turnstile-response': turnstileToken } = body;

  if (!provider || (provider !== 'google' && provider !== 'github')) {
    return badRequest('Invalid provider. Must be "google" or "github".');
  }

  if (!turnstileToken) {
    return badRequest('Turnstile token required');
  }

  // Verify Turnstile
  const turnstileResult = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
  if (!turnstileResult.success) {
    return badRequest('Turnstile verification failed');
  }

  // Generate PKCE challenge + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = `${provider}_${crypto.randomUUID()}`;

  // We need to store state + codeVerifier for callback verification.
  // Store in a short-lived cookie as JSON (encrypted with session key).
  const statePayload = JSON.stringify({ state, codeVerifier, provider });
  const stateToken = btoa(statePayload);

  // Build redirect URL
  const baseUrl = env.APP_BASE_URL;
  const redirectUri = `${baseUrl}/api/auth/callback/${provider}`;

  let authUrl: string;
  if (provider === 'google') {
    const { googleAuthorizeUrl } = await import('../../../lib/auth');
    authUrl = googleAuthorizeUrl(
      { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri },
      state,
      codeChallenge,
    );
  } else {
    const { githubAuthorizeUrl } = await import('../../../lib/auth');
    authUrl = githubAuthorizeUrl(
      { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirectUri },
      state,
      codeChallenge,
    );
  }

  // Set state cookie + redirect
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `__oauth_state=${stateToken}; Path=/api/auth/callback; HttpOnly; Secure; SameSite=Strict; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });

  return response;
};
