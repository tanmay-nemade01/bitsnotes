import type { APIRoute } from 'astro';
import { listSubjects, listLectures } from '../utils/notesLoader';
import { getPublishedPosts } from '../utils/blogLoader';
import { getPublishedBits } from '../utils/bitsLoader';
import { slugify } from '../utils/lectureDisplay';

export const prerender = false;

/**
 * Dynamic sitemap endpoint (hand-rolled instead of @astrojs/sitemap).
 *
 * @astrojs/sitemap expects all routes to be known at build time via
 * getStaticPaths, but this site has a server-rendered contact API and
 * legacy redirect. The hand-rolled approach is simpler to maintain and
 * avoids adding an extra dependency.
 */
export const GET: APIRoute = async ({ url }) => {
  const baseUrl = `${url.protocol}//${url.host}`;

  // Pages to include in sitemap
  const pages = [
    { path: '/',        changefreq: 'weekly',  priority: '1.0' },
    { path: '/about',   changefreq: 'monthly', priority: '0.7' },
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

  const subjects = await listSubjects();
  for (const subject of subjects) {
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

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // cache for 24 hours
      'X-Robots-Tag': 'noindex',                // don't index the sitemap itself
    },
  });
};
