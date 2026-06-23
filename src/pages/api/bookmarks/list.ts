/**
 * GET /api/bookmarks/list
 * Returns all bookmarks grouped by collection.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, getUser } from '../../../lib/apiHelpers';
import { listCollections, listBookmarks } from '../../../lib/bookmarks';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  const collections = await listCollections(env.DB, user.id);
  const bookmarks = await listBookmarks(env.DB, user.id);

  // Group bookmarks by collection
  const grouped: Record<string, any[]> = {};
  const uncategorized: any[] = [];

  for (const bm of bookmarks) {
    if (!grouped[bm.collection_id]) grouped[bm.collection_id] = [];
    grouped[bm.collection_id].push(bm);
  }

  // Flat sorted list for "recently saved" (bookmarks already sorted by created_at DESC)
  const recentBookmarks = bookmarks.slice(0, 5);

  return json({ collections, bookmarks: grouped, uncategorized, recentBookmarks });
};
