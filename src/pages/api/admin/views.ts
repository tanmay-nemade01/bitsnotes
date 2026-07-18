import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, forbidden } from '../../../lib/apiHelpers';
import { getUser } from '../../../lib/apiHelpers';
import { isAdmin } from '../../../lib/comments';
import { logAuthEvent } from '../../../lib/auth';
import { getViewsBatch } from '../../../lib/views';
import { getPublishedPosts } from '../../../utils/blogLoader';
import { listCatalog } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  await logAuthEvent(env.DB, {
    userId: user.id,
    event: 'admin_views_list',
    ip: context.request.headers.get('CF-Connecting-IP') || '',
    ua: context.request.headers.get('User-Agent') || '',
  });

  const keys: string[] = ['home'];

  // Add blog posts
  try {
    const posts = getPublishedPosts();
    for (const post of posts) {
      keys.push(`blog:${post.slug}`);
    }
  } catch (err) {
    console.error('Error fetching posts for views:', err);
  }

  // Add lectures
  try {
    const catalog = await listCatalog();
    for (const item of catalog) {
      for (const lec of item.lectures) {
        keys.push(`lecture:${item.subject}:${lec.folderName}`);
      }
    }
  } catch (err) {
    console.error('Error fetching catalog for views:', err);
  }

  let viewsList: Array<{ pageKey: string; views: number }> = [];
  try {
    const viewsMap = await getViewsBatch(env.DB, keys);
    viewsList = keys.map((key) => ({
      pageKey: key,
      views: viewsMap.get(key) ?? 0,
    }));
  } catch (err) {
    console.error('Error getting views batch:', err);
    viewsList = keys.map((key) => ({
      pageKey: key,
      views: 0,
    }));
  }

  // Sort views descending
  viewsList.sort((a, b) => b.views - a.views);

  return json({ views: viewsList }, 200, { 'Cache-Control': 'no-store' });
};
