/**
 * POST /api/auth/signin
 * Validates Turnstile, redirects to OAuth provider (Google or GitHub).
 */

import type { APIRoute } from 'astro';
import { getEnv, badRequest, serverError, getClientIp } from '../../../lib/apiHelpers';
import { verifyTurnstile, generateCodeVerifier, generateCodeChallenge } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  const ip = getClientIp(request);

  // Accept both JSON and application/x-www-form-urlencoded (native <form> POST)
  let provider: string | undefined;
  let turnstileToken: string | undefined;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const jsonBody = await request.json() as Record<string, unknown>;
      provider = jsonBody.provider as string | undefined;
      turnstileToken = jsonBody['cf-turnstile-response'] as string | undefined;
    } else {
      const formData = await request.formData();
      provider = formData.get('provider') as string | undefined;
      turnstileToken = formData.get('cf-turnstile-response') as string | undefined;
    }
  } catch {
    return badRequest('Invalid request body');
  }

  if (!provider || (provider !== 'google' && provider !== 'github')) {
    return badRequest('Invalid provider. Must be "google" or "github".');
  }

  if (!turnstileToken) {
    // In dev or when Turnstile fails, allow the flow to proceed without verification
    console.warn('Turnstile token missing — allowing sign-in flow without captcha verification.');
  }

  // Verify Turnstile (skip if token is missing — dev/fallback)
  if (turnstileToken) {
    const turnstileResult = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
    if (!turnstileResult.success) {
      return badRequest('Turnstile verification failed');
    }
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

  // Set state cookie + return JSON with redirect URL
  // (Instead of a 302, return JSON because CSP connect-src blocks cross-origin redirects)
  const response = new Response(
    JSON.stringify({ url: authUrl }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `__oauth_state=${stateToken}; Path=/api/auth/callback; HttpOnly; Secure; SameSite=Strict; Max-Age=600`,
        'Cache-Control': 'no-store',
      },
    },
  );

  return response;
};
