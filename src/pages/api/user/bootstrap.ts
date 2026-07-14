/**
 * GET /api/user/bootstrap?subject=<optional>
 *
 * Consolidates the per-page auth/bookmarks/progress requests into a single
 * round-trip (Phase 8.6). Signed-out callers get a 401 with no D1 query.
 *
 * Response (200):
 *   {
 *     user: { id, email, displayName, avatarUrl, status } | null,
 *     bookmarks: { collections, bookmarks, uncategorized, recentBookmarks },
 *     progress: { lectures } | { summary }
 *   }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { listCollections, listBookmarks } from '../../../lib/bookmarks';
import { listProgress, getProgressSummary, listTopicProgress } from '../../../lib/progress';
import { listCatalog } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  const url = new URL(context.request.url);
  const subject = url.searchParams.get('subject');
  const lecture = url.searchParams.get('lecture');

  // Bookmarks (grouped by collection, with catalog titles).
  const collections = await listCollections(env.DB, user.id);
  const bookmarks = await listBookmarks(env.DB, user.id);

  const catalog = await listCatalog();
  const titleLookup = new Map<string, string>();
  for (const s of catalog) {
    for (const lec of s.lectures) {
      titleLookup.set(`${s.subject}::${lec.folderName}`, lec.displayTitle || lec.name);
    }
  }
  const withTitles = (bm: any) => ({
    ...bm,
    display_title: titleLookup.get(`${bm.subject}::${bm.lecture}`) || bm.display_name,
  });

  const grouped: Record<string, any[]> = {};
  for (const bm of bookmarks) {
    if (!grouped[bm.collection_id]) grouped[bm.collection_id] = [];
    grouped[bm.collection_id].push(withTitles(bm));
  }
  const recentBookmarks = bookmarks.slice(0, 5).map(withTitles);

  // Progress (per-subject if requested, else summary).
  let progress: any;
  if (subject) {
    const normalized = sanitizeString(subject, 200);
    if (!normalized) return badRequest('Invalid subject');
    const lectures = await listProgress(env.DB, user.id, normalized);
    
    let topicProgress: any[] = [];
    if (lecture) {
      const normalizedLec = sanitizeString(lecture, 200);
      if (normalizedLec) {
        topicProgress = await listTopicProgress(env.DB, user.id, normalized, normalizedLec);
      }
    }
    progress = { lectures, topicProgress };
  } else {
    progress = { summary: await getProgressSummary(env.DB, user.id) };
  }

  return json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
    },
    bookmarks: { collections, bookmarks: grouped, uncategorized: [], recentBookmarks },
    progress,
  });
};
