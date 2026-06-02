import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listSubjects, listLectures } from '../utils/r2Structure';

/**
 * Dynamic SSR sitemap endpoint.
 * Lists all static and dynamic indexable public pages.
 */
export const GET: APIRoute = async ({ url }) => {
  const baseUrl = `${url.protocol}//${url.host}`;
  const bucket = env?.BUCKET;

  // Pages to include in sitemap
  const pages = [
    { path: '/',        changefreq: 'weekly',  priority: '1.0' },
    { path: '/about',   changefreq: 'monthly', priority: '0.7' },
    { path: '/contact', changefreq: 'monthly', priority: '0.6' },
    { path: '/privacy', changefreq: 'yearly',  priority: '0.4' },
    { path: '/terms',   changefreq: 'yearly',  priority: '0.4' },
  ];

  if (bucket) {
    try {
      const subjects = await listSubjects(bucket as any);
      for (const subject of subjects) {
        const subjectParam = encodeURIComponent(subject.name);
        pages.push({
          path: `/subject/${subjectParam}`,
          changefreq: 'weekly',
          priority: '0.8',
        });

        const lectures = await listLectures(bucket as any, subject.name);
        for (const lecture of lectures) {
          const viewPath = `/view/${subjectParam}/${encodeURIComponent(lecture.name)}`;
          pages.push({
            path: viewPath,
            changefreq: 'weekly',
            priority: '0.8',
          });
        }
      }
    } catch (error) {
      console.error('Failed to list subjects/lectures for sitemap:', error);
    }
  } else {
    // Fallback/Demo Mode if Cloudflare R2 binding is not available (e.g. local dev)
    const demoSubjects = [
      { name: 'Deep Reinforcement Learning', lectures: ['Lecture 1', 'Lecture 2', 'Lecture 3', 'Lecture 4', 'Lecture 5'] },
      { name: 'Machine Learning', lectures: ['Lecture 1', 'Lecture 2', 'Lecture 3', 'Lecture 4', 'Lecture 5'] },
      { name: 'Computer Networks', lectures: ['Lecture 1', 'Lecture 2', 'Lecture 3', 'Lecture 4', 'Lecture 5'] },
    ];

    for (const subject of demoSubjects) {
      const subjectParam = encodeURIComponent(subject.name);
      pages.push({
        path: `/subject/${subjectParam}`,
        changefreq: 'weekly',
        priority: '0.8',
      });

      for (const lectureName of subject.lectures) {
        const viewPath = `/view/${subjectParam}/${encodeURIComponent(lectureName)}`;
        pages.push({
          path: viewPath,
          changefreq: 'weekly',
          priority: '0.8',
        });
      }
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
