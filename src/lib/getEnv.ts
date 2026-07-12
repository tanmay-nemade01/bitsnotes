/**
 * Get Cloudflare env bindings.
 * Astro v6 removed context.locals.runtime.env — use cloudflare:workers instead.
 * The Cloudflare Vite plugin shims this import for local dev.
 */

import type { D1Database, SendEmail } from '@cloudflare/workers-types';

export interface AppEnv {
  DB: D1Database;
  SEND_EMAIL: SendEmail;
  SESSION_SIGNING_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
  APP_BASE_URL: string;
  API_SECRET_KEY?: string;
  COMMENT_RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  FEEDBACK_RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
}

let _envCache: AppEnv | null = null;

export async function getEnv(): Promise<AppEnv> {
  if (_envCache) return _envCache;
  try {
    const { env: cfEnv } = await import('cloudflare:workers');
    _envCache = cfEnv as unknown as AppEnv;
    return _envCache!;
  } catch {
    return {} as AppEnv;
  }
}
