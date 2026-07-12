/**
 * Functional visitor cookie (Phase 5+ foundation).
 *
 * A random, opaque visitor ID is stored in a cookie. We NEVER store the raw
 * cookie in D1 — only HMAC(cookieId) — so feedback/votes can be deduplicated
 * and attributed to a returning visitor without persisting any personal data.
 *
 * The cookie is reused by later Phase 5+ features (e.g. lightweight
 * personalization, dedupe of other anonymous interactions).
 */

import { hmacSign } from './auth/crypto';

export const VISITOR_COOKIE = 'bitsnotes-visitor';
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365 * 2; // ~2 years

/** Generate a fresh opaque visitor id. */
export function generateVisitorId(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Build a Set-Cookie header value for a new visitor id.
 * SameSite=Lax, Secure, long TTL. Not HttpOnly so the client can read/reflect
 * state if needed (the raw id is opaque and non-sensitive).
 */
export function visitorCookieHeader(id: string): string {
  const parts = [
    `${VISITOR_COOKIE}=${id}`,
    'Path=/',
    'SameSite=Lax',
    'Secure',
    `Max-Age=${COOKIE_TTL_SECONDS}`,
    'HttpOnly=false',
  ];
  return parts.join('; ');
}

/** Read the visitor id from a request, or null if absent. */
export function getVisitorId(request: Request): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const prefix = `${VISITOR_COOKIE}=`;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const id = decodeURIComponent(trimmed.slice(prefix.length));
      return id || null;
    }
  }
  return null;
}

/** HMAC the visitor id with the provided secret (e.g. SESSION_SIGNING_KEY). */
export async function hashVisitor(id: string, secret: string): Promise<string> {
  return hmacSign(secret, `visitor:${id}`);
}
