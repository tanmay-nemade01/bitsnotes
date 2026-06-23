/**
 * CSRF protection helpers.
 * Validates Origin/Referer headers against expected base URL.
 */

/**
 * Validate that a request is same-origin by checking Origin or Referer header.
 * Returns true if valid (or if header is missing — for GET requests / cookie-only CSRF).
 */
export function validateOrigin(request: Request, baseUrl: string): boolean {
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const base = new URL(baseUrl);
      return originUrl.origin === base.origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const base = new URL(baseUrl);
      return refererUrl.origin === base.origin;
    } catch {
      return false;
    }
  }

  // No Origin or Referer — could be a direct navigation (GET) or a non-browser client.
  // For POST endpoints, this should be rejected. Caller decides.
  return false;
}

/**
 * Create a standard 403 Forbidden response for CSRF failures.
 */
export function csrfForbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden: CSRF validation failed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
