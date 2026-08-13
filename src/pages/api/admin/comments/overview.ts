import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, forbidden } from '../../../../lib/apiHelpers';
import { getUser } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { logAuthEvent } from '../../../../lib/auth';
import { getPublishedPosts } from '../../../../utils/blogLoader';
import { listCatalog } from '../../../../utils/notesLoader';
import { slugify } from '../../../../utils/lectureDisplay';

export const prerender = false;

interface CommentRow {
  id: string;
  page_type: string;
  subject: string;
  lecture: string | null;
  parent_id: string | null;
  depth: number;
  display_name: string;
  body: string;
  status: string;
  moderation_reason: string | null;
  author_user_id: string | null;
  score: number;
  report_count: number;
  created_at: number;
  updated_at: number;
}

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  await logAuthEvent(env.DB, {
    userId: user.id,
    event: 'admin_comments_overview',
    ip: context.request.headers.get('CF-Connecting-IP') || '',
    ua: context.request.headers.get('User-Agent') || '',
  });

  // Load catalog for deep-link resolution
  const catalog = await listCatalog();
  const lectureMap = new Map<string, { slug: string; displayTitle: string; subjectSlug: string; subjectDisplay: string }>();
  for (const item of catalog) {
    const subjectSlug = slugify(item.subject);
    for (const lec of item.lectures) {
      const key = `${item.subject}:${lec.folderName}`;
      lectureMap.set(key, {
        slug: lec.slug,
        displayTitle: lec.displayTitle,
        subjectSlug,
        subjectDisplay: item.subject,
      });
    }
  }

  const blogPosts = await getPublishedPosts();
  const blogBySlug = new Map(blogPosts.map((p) => [p.slug, p]));

  // Fetch comments
  const rows = await env.DB.prepare(
    `SELECT id, page_type, subject, lecture, parent_id, depth, display_name, body, status, moderation_reason, author_user_id, score, report_count, created_at, updated_at
     FROM comments ORDER BY created_at DESC`
  ).all<CommentRow>();

  const items = rows.results ?? [];

  // Batch query admin status for authors
  const adminIds = new Set<string>();
  const userIds = Array.from(new Set(items.map((r) => r.author_user_id).filter(Boolean)));
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(', ');
    const adminRows = await env.DB.prepare(
      `SELECT user_id FROM admin_users WHERE user_id IN (${placeholders})`
    ).bind(...userIds).all<{ user_id: string }>();
    if (adminRows.results) {
      for (const r of adminRows.results) {
        adminIds.add(r.user_id);
      }
    }
  }

  const pagesMap = new Map<string, {
    pageType: string;
    subject: string;
    lecture: string | null;
    label: string;
    total: number;
    published: number;
    pending: number;
    hidden: number;
    newestTimestamp: number;
    comments: any[];
  }>();

  for (const c of items) {
    const pageKey = `${c.page_type}:${c.subject}:${c.lecture || ''}`;
    
    // Resolve page URL and label
    let pageUrl = '/';
    let label = '';
    
    if (c.page_type === 'blog') {
      pageUrl = `/blog/${c.subject}#comment-${c.id}`;
      const post = blogBySlug.get(c.subject);
      label = `Blog: ${post ? post.frontmatter.title : c.subject}`;
    } else if (c.page_type === 'lecture') {
      const lookupKey = `${c.subject}:${c.lecture || ''}`;
      const info = lectureMap.get(lookupKey);
      if (info) {
        pageUrl = `/view/${info.subjectSlug}/${info.slug}#comment-${c.id}`;
        label = `${info.subjectDisplay} > ${info.displayTitle}`;
      } else {
        pageUrl = `/view/${slugify(c.subject)}/${slugify(c.lecture || '')}#comment-${c.id}`;
        label = `${c.subject} > ${c.lecture || ''}`;
      }
    } else if (c.page_type === 'subject') {
      pageUrl = `/subject/${slugify(c.subject)}#comment-${c.id}`;
      label = `Subject: ${c.subject}`;
    }

    if (!pagesMap.has(pageKey)) {
      pagesMap.set(pageKey, {
        pageType: c.page_type,
        subject: c.subject,
        lecture: c.lecture,
        label,
        total: 0,
        published: 0,
        pending: 0,
        hidden: 0,
        newestTimestamp: c.created_at,
        comments: [],
      });
    }

    const group = pagesMap.get(pageKey)!;
    group.total++;
    if (c.status === 'published') group.published++;
    else if (c.status === 'pending') group.pending++;
    else if (c.status === 'hidden') group.hidden++;

    group.comments.push({
      id: c.id,
      displayName: c.display_name,
      body: c.body,
      status: c.status,
      score: c.score,
      reportCount: c.report_count,
      moderationReason: c.moderation_reason,
      createdAt: c.created_at,
      isAdmin: c.author_user_id ? adminIds.has(c.author_user_id) : false,
      pageUrl,
    });
  }

  const result = Array.from(pagesMap.values());
  // Sort pages by the newest activity first
  result.sort((a, b) => b.newestTimestamp - a.newestTimestamp);

  return json({ pages: result }, 200, { 'Cache-Control': 'no-store' });
};
