/**
 * GET /api/bookmarks/list
 * Returns all bookmarks grouped by collection.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, getUser } from '../../../lib/apiHelpers';
import { listCollections, listBookmarks } from '../../../lib/bookmarks';
import { getHiddenSubjectNames } from '../../../lib/subjectVisibility';
import { listCatalog } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) {
    return json({ collections: {}, bookmarks: {}, uncategorized: [], recentBookmarks: [], loggedIn: false }, 200);
  }

  const env = await getEnv(context);
  const collections = await listCollections(env.DB, user.id);
  const rawBookmarks = await listBookmarks(env.DB, user.id);

  const isAdmin = Boolean((context.locals as any).isAdmin);
  const hiddenSubjects = await getHiddenSubjectNames(env.DB);
  const bookmarks = (!isAdmin && hiddenSubjects.size > 0)
    ? rawBookmarks.filter((bm) => !hiddenSubjects.has(bm.subject))
    : rawBookmarks;

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
