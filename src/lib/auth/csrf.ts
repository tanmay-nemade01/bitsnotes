/**
 * CSRF protection helpers.
 * Validates Origin/Referer headers against expected base URL (apex + www).
 */

/** Origins accepted for APP_BASE_URL (includes www/apex twin). */
export function allowedOrigins(baseUrl?: string): Set<string> {
  const origins = new Set<string>();
  if (!baseUrl) return origins;
  try {
    const base = new URL(baseUrl);
    origins.add(base.origin);
    if (base.hostname.startsWith('www.')) {
      origins.add(`${base.protocol}//${base.hostname.slice(4)}`);
    } else if (base.hostname.includes('.')) {
      origins.add(`${base.protocol}//www.${base.hostname}`);
    }
  } catch {
    // Invalid base — empty set fails closed
  }
  return origins;
}

/**
 * Validate that a request is same-origin by checking Origin or Referer header.
 * Accepts both apex and www variants of the configured base URL, as well as
 * the request's own origin.
 */
export function validateOrigin(request: Request, baseUrl?: string): boolean {
  const allowed = allowedOrigins(baseUrl);

  // Allow same-origin requests matching the request URL itself
  try {
    const reqOrigin = new URL(request.url).origin;
    if (reqOrigin && reqOrigin !== 'null') {
      allowed.add(reqOrigin);
    }
  } catch {
    // Ignore invalid request URL
  }

  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      return allowed.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  // No Origin or Referer — reject for POST (caller decides).
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
