/**
 * GET /api/bookmarks/list
 * Returns all bookmarks grouped by collection.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, getUser } from '../../../lib/apiHelpers';
import { listCollections, listBookmarks } from '../../../lib/bookmarks';
import { listCatalog } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  const collections = await listCollections(env.DB, user.id);
  const bookmarks = await listBookmarks(env.DB, user.id);

  // Normalize bookmark titles to match the catalog (lecture-number prefixed).
  const catalog = await listCatalog();
  const titleLookup = new Map<string, string>();
  for (const subject of catalog) {
    for (const lec of subject.lectures) {
      titleLookup.set(`${subject.subject}::${lec.folderName}`, lec.displayTitle || lec.name);
    }
  }
  const withTitles = (bm: any) => ({
    ...bm,
    display_title: titleLookup.get(`${bm.subject}::${bm.lecture}`) || bm.display_name,
  });

  // Group bookmarks by collection
  const grouped: Record<string, any[]> = {};
  const uncategorized: any[] = [];

  for (const bm of bookmarks) {
    if (!grouped[bm.collection_id]) grouped[bm.collection_id] = [];
    grouped[bm.collection_id].push(withTitles(bm));
  }

  // Flat sorted list for "recently saved" (bookmarks already sorted by created_at DESC)
  const recentBookmarks = bookmarks.slice(0, 5).map(withTitles);

  return json({ collections, bookmarks: grouped, uncategorized, recentBookmarks });
};
