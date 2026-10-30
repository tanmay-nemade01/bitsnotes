import { allowedOrigins } from './csrf';

/** Returns a same-site relative path safe to use in a Location header, or null. */
export function safeRedirectPath(raw: unknown, baseUrl: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null;
  let parsed: URL;
  try { parsed = new URL(raw, baseUrl); } catch { return null; }
  if (!allowedOrigins(baseUrl).has(parsed.origin)) return null;
  const path = parsed.pathname + parsed.search + parsed.hash;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

