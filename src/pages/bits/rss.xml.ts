import type { APIRoute } from 'astro';
import { getPublishedBits, bitPreview } from '../../utils/bitsLoader';

export const prerender = false;

function cdata(value: string): string {
  return value.replace(/]]>/g, ']]&gt;');
}

export const GET: APIRoute = async ({ url }) => {
  const baseUrl = `${url.protocol}//${url.host}`;
  const bits = await getPublishedBits();

  const items = bits
    .map((bit) => {
      const title = bitPreview(bit);
      const description = bit.frontmatter.text || bit.frontmatter.link?.title || title;
      return `
    <item>
      <title><![CDATA[${cdata(title)}]]></title>
      <description><![CDATA[${cdata(description)}]]></description>
      <link>${baseUrl}/bits/${bit.slug}</link>
      <guid isPermaLink="true">${baseUrl}/bits/${bit.slug}</guid>
      <pubDate>${new Date(bit.frontmatter.publishedAt).toUTCString()}</pubDate>
    </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BitsNotes Bits</title>
    <link>${baseUrl}/bits</link>
    <description>Short takes, links, and the occasional meme.</description>
    <language>en</language>
    <atom:link href="${baseUrl}/bits/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'X-Robots-Tag': 'noindex',
    },
  });
};
