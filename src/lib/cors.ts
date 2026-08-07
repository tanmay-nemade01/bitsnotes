/**
 * CORS helpers for the mobile/v1 content API.
 * Echoes Access-Control-Allow-Origin only for known BitsNotes origins.
 * Requests with no Origin header (native clients) are allowed without ACAO.
 */

import { allowedOrigins } from './auth/csrf';

const ALLOW_HEADERS = 'Content-Type, Authorization, x-api-key';
const ALLOW_METHODS = 'GET, OPTIONS';

export function v1CorsHeaders(
  request: Request,
  baseUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Content-Type': 'application/json',
  };

  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      const allowed = allowedOrigins(baseUrl || 'https://bitsnotes.com');
      if (allowed.has(new URL(origin).origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
      }
    } catch {
      // Invalid Origin — omit ACAO (browser will block)
    }
  }

  return headers;
}

export function v1OptionsResponse(request: Request, baseUrl: string): Response {
  const headers = v1CorsHeaders(request, baseUrl);
  delete headers['Content-Type'];
  return new Response(null, { status: 204, headers });
}

/** Constant-time string compare for API keys (length mismatch still returns false). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export function checkApiKey(request: Request, expectedKey: string | undefined): boolean {
  if (!expectedKey) return false;
  const authHeader = request.headers.get('Authorization') || request.headers.get('x-api-key') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return timingSafeEqual(authHeader, expectedKey) || timingSafeEqual(bearer, expectedKey);
}
