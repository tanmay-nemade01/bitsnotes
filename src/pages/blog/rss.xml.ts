import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../../utils/blogLoader';

export const prerender = true;

export const GET: APIRoute = async ({ url }) => {
  const baseUrl = `${url.protocol}//${url.host}`;
  const posts = getPublishedPosts();

  const items = posts
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.frontmatter.title}]]></title>
      <description><![CDATA[${post.frontmatter.description}]]></description>
      <link>${baseUrl}/blog/${post.slug}</link>
      <guid isPermaLink="true">${baseUrl}/blog/${post.slug}</guid>
      <pubDate>${new Date(post.frontmatter.publishedAt).toUTCString()}</pubDate>
      ${(post.frontmatter.tags ?? []).map((tag: string) => `<category>${tag}</category>`).join('\n      ')}
    </item>`,
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BitsNotes Blog</title>
    <link>${baseUrl}/blog</link>
    <description>Thoughts on AI, ML, study strategies, and postgraduate life.</description>
    <language>en</language>
    <atom:link href="${baseUrl}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
};
