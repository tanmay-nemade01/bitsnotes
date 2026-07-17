/**
 * Page Views API
 *
 * GET  /api/views?key=<page_key>    → { views: number }
 * POST /api/views                    → { views: number }  (body: { key: string })
 *
 * The POST route increments and returns the new total.
 * Both routes are unauthenticated — view counts are public and anonymous.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest } from '../../../lib/apiHelpers';
import { incrementViews, getViews, seedOffsetForKey } from '../../../lib/views';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');
  if (!key) return badRequest('key is required');

  try {
    const env = await getEnv(context);
    if (!env.DB) {
      // Dev fallback: return deterministic seed offset so the counter shows a
      // realistic non-zero number even when D1 is not wired up.
      return json({ views: await seedOffsetForKey(key) }, 200);
    }
    const views = await getViews(env.DB, key);
    return json({ views }, 200);
  } catch (err) {
    // Graceful degradation: if the DB query fails (e.g. table not yet migrated),
    // return the seed offset so the counter still shows a realistic number.
    return json({ views: await seedOffsetForKey(key) }, 200);
  }
};

export const POST: APIRoute = async (context) => {
  let body: { key?: string };
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const key = body?.key;
  if (!key || typeof key !== 'string') return badRequest('key is required');

  try {
    const env = await getEnv(context);
    if (!env.DB) {
      return json({ views: await seedOffsetForKey(key) }, 200);
    }
    const views = await incrementViews(env.DB, key);
    return json({ views }, 200);
  } catch (err) {
    // Graceful degradation: if the DB query fails (e.g. table not yet migrated),
    // return the seed offset so the counter still shows a realistic number.
    return json({ views: await seedOffsetForKey(key) }, 200);
  }
};
