import type { APIRoute } from 'astro';
import { listSubjects, listLectures, getManifest } from '../utils/notesLoader';
import { getPublishedPosts } from '../utils/blogLoader';
import { getPublishedBits } from '../utils/bitsLoader';
import { slugify } from '../utils/lectureDisplay';
import { getEnv } from '../lib/apiHelpers';
import { getHiddenSubjectNames } from '../lib/subjectVisibility';

export const prerender = false;

let devCachedXml: string | null = null;
let devCachedVersion: string | null = null;

/**
 * Dynamic sitemap endpoint (hand-rolled instead of @astrojs/sitemap).
 * Cached at Cloudflare Edge via caches.default (24h TTL) to prevent repeated
 * bot crawls from executing note manifest/subject queries.
 */
export const GET: APIRoute = async (context) => {
  const { url } = context;
  const baseUrl = `${url.protocol}//${url.host}`;

  const manifest = await getManifest().catch(() => null);
  const version = manifest?.version || new Date().toISOString().split('T')[0];

  if (import.meta.env.DEV) {
    if (devCachedXml && devCachedVersion === version) {
      return new Response(devCachedXml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Robots-Tag': 'noindex',
        },
      });
    }
  }

  // Edge cache lookup (production Cloudflare Workers)
  const cache = typeof caches !== 'undefined' && (caches as any)?.default
    ? ((caches as any).default as Cache)
    : ((globalThis as any)?.caches?.default as Cache | undefined);
  const cacheKey = new Request(`https://bitsnotes.com/__cache/sitemap/${encodeURIComponent(version)}.xml`);

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch { /* cache read is best-effort */ }
  }

  // Pages to include in sitemap
  const pages = [
    { path: '/',        changefreq: 'weekly',  priority: '1.0' },
    { path: '/about',   changefreq: 'monthly', priority: '0.7' },
    { path: '/support', changefreq: 'monthly', priority: '0.5' },
    { path: '/contact', changefreq: 'monthly', priority: '0.6' },
    { path: '/privacy', changefreq: 'yearly',  priority: '0.4' },
    { path: '/terms',   changefreq: 'yearly',  priority: '0.4' },
    { path: '/blog',    changefreq: 'weekly',  priority: '0.8' },
    { path: '/bits',    changefreq: 'daily',   priority: '0.6' },
  ];

  const blogPosts = await getPublishedPosts();
  for (const post of blogPosts) {
    pages.push({
      path: `/blog/${post.slug}`,
      changefreq: 'monthly',
      priority: '0.7',
    });
  }

  const bits = await getPublishedBits();
  for (const bit of bits) {
    pages.push({
      path: `/bits/${bit.slug}`,
      changefreq: 'monthly',
      priority: '0.5',
    });
  }

  const env = await getEnv(context).catch(() => null);
  const hiddenSubjects = await getHiddenSubjectNames(env?.DB);
  const subjects = await listSubjects();
  const publicSubjects = subjects.filter((s) => !hiddenSubjects.has(s.name));

  for (const subject of publicSubjects) {
    const subjectParam = slugify(subject.name);
    pages.push({
      path: `/subject/${subjectParam}`,
      changefreq: 'weekly',
      priority: '0.8',
    });

    const lectures = await listLectures(subject.name);
    for (const lecture of lectures) {
      const viewPath = `/view/${subjectParam}/${encodeURIComponent(lecture.slug)}`;
      pages.push({
        path: viewPath,
        changefreq: 'weekly',
        priority: '0.8',
      });
    }
  }

  const lastmod = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const urls = pages
    .map(
      ({ path, changefreq, priority }) => `
  <url>
    <loc>${baseUrl}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
    http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd"
>${urls}
</urlset>`;

  if (import.meta.env.DEV) {
    devCachedXml = xml;
    devCachedVersion = version;
  }

  const response = new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400', // cache for 24 hours at edge & browser
      'X-Robots-Tag': 'noindex',                                // don't index the sitemap itself
    },
  });

  if (cache) {
    try {
      cache.put(cacheKey, response.clone()).catch(() => {});
    } catch { /* cache write is best-effort */ }
  }

  return response;
};
