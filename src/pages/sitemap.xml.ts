import type { APIRoute } from 'astro';

/**
 * Dynamic SSR sitemap endpoint.
 * Lists all static, indexable public pages.
 * Dynamic routes like /subject/[subject] and /view/[...path] are intentionally
 * excluded — subject pages could be added here once subjects are known at
 * build-time via a data source.
 */
export const GET: APIRoute = ({ url }) => {
  const baseUrl = `${url.protocol}//${url.host}`;

  // Static pages to include in sitemap
  const staticPages = [
    { path: '/',        changefreq: 'weekly',  priority: '1.0' },
    { path: '/about',   changefreq: 'monthly', priority: '0.7' },
    { path: '/contact', changefreq: 'monthly', priority: '0.6' },
    { path: '/privacy', changefreq: 'yearly',  priority: '0.4' },
    { path: '/terms',   changefreq: 'yearly',  priority: '0.4' },
  ];

  const lastmod = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const urls = staticPages
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
