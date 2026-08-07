/**
 * Page Views API
 *
 * GET  /api/views?key=<page_key>    → { views: number }
 * POST /api/views                    → { views: number }  (body: { key: string })
 *
 * The POST route increments and returns the new total.
 * Both routes are unauthenticated — view counts are public and anonymous.
 * Keys must match known pages; POST is rate-limited and same-origin.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, tooMany } from '../../../lib/apiHelpers';
import { incrementViews, getViews, seedOffsetForKey, isValidViewKey } from '../../../lib/views';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { getClientIp } from '../../../lib/apiHelpers';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');
  if (!key) return badRequest('key is required');
  if (!(await isValidViewKey(key))) return badRequest('Unknown page key');

  try {
    const env = await getEnv(context);
    if (!env.DB) {
      // Dev fallback: return deterministic seed offset so the counter shows a
      // realistic non-zero number even when D1 is not wired up.
      return json({ views: await seedOffsetForKey(key) }, 200);
    }
    const views = await getViews(env.DB, key);
    return json({ views }, 200);
  } catch {
    // Graceful degradation: if the DB query fails (e.g. table not yet migrated),
    // return the seed offset so the counter still shows a realistic number.
    return json({ views: await seedOffsetForKey(key) }, 200);
  }
};

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);

  if (!validateOrigin(context.request, env.APP_BASE_URL || 'https://bitsnotes.com')) {
    return csrfForbidden();
  }

  if (env.VIEWS_RATE_LIMITER) {
    const ip = getClientIp(context.request);
    const { success } = await env.VIEWS_RATE_LIMITER.limit({ key: `views:${ip}` });
    if (!success) return tooMany('Too many requests. Please try again later.');
  }

  let body: { key?: string };
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const key = body?.key;
  if (!key || typeof key !== 'string') return badRequest('key is required');
  if (!(await isValidViewKey(key))) return badRequest('Unknown page key');

  try {
    if (!env.DB) {
      return json({ views: await seedOffsetForKey(key) }, 200);
    }
    const views = await incrementViews(env.DB, key);
    return json({ views }, 200);
  } catch {
    // Graceful degradation: if the DB query fails (e.g. table not yet migrated),
    // return the seed offset so the counter still shows a realistic number.
    return json({ views: await seedOffsetForKey(key) }, 200);
  }
};
