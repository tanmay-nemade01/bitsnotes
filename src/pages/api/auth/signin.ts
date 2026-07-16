/**
 * POST /api/auth/signin
 * Validates Turnstile, redirects to OAuth provider (Google or GitHub).
 */

import type { APIRoute } from 'astro';
import { getEnv, badRequest, getClientIp } from '../../../lib/apiHelpers';
import { verifyTurnstile, generateCodeVerifier, generateCodeChallenge, hmacSign } from '../../../lib/auth';
import { isSecure } from '../../../lib/auth/session';
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

  // Accept both JSON and application/x-www-form-urlencoded (native <form> POST)
  let provider: string | undefined;
  let turnstileToken: string | undefined;
  let redirectUrl: string | undefined;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const jsonBody = await request.json() as Record<string, unknown>;
      provider = jsonBody.provider as string | undefined;
      turnstileToken = jsonBody['cf-turnstile-response'] as string | undefined;
      redirectUrl = jsonBody.redirect as string | undefined;
    } else {
      const formData = await request.formData();
      provider = formData.get('provider') as string | undefined;
      turnstileToken = formData.get('cf-turnstile-response') as string | undefined;
      redirectUrl = formData.get('redirect') as string | undefined;
    }
  } catch {
    return badRequest('Invalid request body');
  }

  // Validate redirect URL (must be same-origin)
  if (redirectUrl) {
    try {
      const parsed = new URL(redirectUrl, env.APP_BASE_URL);
      if (parsed.origin !== env.APP_BASE_URL) {
        redirectUrl = undefined;
      }
    } catch {
      redirectUrl = undefined;
    }
  }

  if (!provider || (provider !== 'google' && provider !== 'github')) {
    return badRequest('Invalid provider. Must be "google" or "github".');
  }

  if (!turnstileToken) {
    // Require Turnstile in production when the secret is configured
    if (env.TURNSTILE_SECRET_KEY) {
      return badRequest('Turnstile verification required');
    }
    console.warn('Turnstile token missing — allowing sign-in flow without captcha verification (no secret key configured).');
  }

  // Verify Turnstile
  if (turnstileToken && env.TURNSTILE_SECRET_KEY) {
    const turnstileResult = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
    if (!turnstileResult.success) {
      return badRequest('Turnstile verification failed');
    }
  }

  // Generate PKCE challenge + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = `${provider}_${crypto.randomUUID()}`;

  // Store state + codeVerifier + redirect in a signed cookie for callback verification.
  const statePayload = JSON.stringify({ state, codeVerifier, provider, redirect: redirectUrl || null });
  const payloadB64 = btoa(statePayload);
  const stateSig = await hmacSign(env.SESSION_SIGNING_KEY, payloadB64);
  const stateToken = `${payloadB64}.${stateSig}`;

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
        'Set-Cookie': `__oauth_state=${stateToken}; Path=/api/auth/callback; HttpOnly;${isSecure(request) ? ' Secure;' : ''} SameSite=Lax; Max-Age=600`,
        'Cache-Control': 'no-store',
      },
    },
  );

  return response;
};
