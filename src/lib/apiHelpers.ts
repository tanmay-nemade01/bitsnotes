/**
 * Shared API helpers.
 * Provides typed access to env bindings, user resolution, JSON responses.
 */

import type { APIContext } from 'astro';
import { verifyJwt, getSessionTokenFromCookie, findUserById, getEntitlement, type AuthDb } from '../lib/auth';

// ─── Env access (Astro v6: use cloudflare:workers) ─────────────────────────

export interface EnvBindings {
  DB: AuthDb;
  SESSION_SIGNING_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  APP_BASE_URL: string;
  SEND_EMAIL: any;
}

export async function getEnv(context?: APIContext): Promise<EnvBindings> {
  try {
    const { getEnv: getCFEnv } = await import('./getEnv');
    const env = await getCFEnv();
    return env as unknown as EnvBindings;
  } catch {
    return {} as EnvBindings;
  }
}

// ─── User resolution ────────────────────────────────────────────────────────

export interface ApiUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
}

/**
 * Get the current user from locals (already resolved by middleware) or null.
 */
export function getUser(context: APIContext): ApiUser | null {
  return (context.locals as any).user ?? null;
}

/**
 * Get user + tier from locals.
 */
export function getUserTier(context: APIContext): { user: ApiUser | null; tier: string } {
  return {
    user: (context.locals as any).user ?? null,
    tier: (context.locals as any).tier ?? 'free',
  };
}

// ─── JSON responses ─────────────────────────────────────────────────────────

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

export function unauthorized(message = 'Authentication required'): Response {
  return json({ error: message }, 401);
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function forbidden(message = 'Forbidden'): Response {
  return json({ error: message }, 403);
}

export function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404);
}

export function tooMany(message = 'Too many requests'): Response {
  return json({ error: message }, 429);
}

export function serverError(message = 'Internal server error'): Response {
  return json({ error: message }, 500);
}

// ─── Input validation ───────────────────────────────────────────────────────

/**
 * Validate required fields exist and are strings.
 */
export function validateFields(body: Record<string, unknown>, required: string[]): string | null {
  for (const field of required) {
    const val = body[field];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}

/**
 * Sanitize a string: trim, strip control chars, limit length.
 */
export function sanitizeString(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLength);
}

/**
 * Normalize email: lowercase, trim.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

/**
 * Extract User-Agent from request.
 */
export function getClientUa(request: Request): string {
  return (request.headers.get('User-Agent') || '').slice(0, 200);
}
