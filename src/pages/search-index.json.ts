import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCatalog, getLectureContent, getManifest } from '../utils/notesLoader';
import { getPublishedPosts } from '../utils/blogLoader';
import { getPublishedBits, bitPreview } from '../utils/bitsLoader';

export const prerender = false;

let devCachedIndex: any[] | null = null;
let devCachedManifestVersion: string | null = null;

function cleanHtmlText(html: string): string {
  // Strip style tags and content
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  // Strip script tags and content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  // Strip head tags and content
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  // Strip iframe tags and content
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  // Strip svg tags and content
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

export const GET: APIRoute = async () => {
  // In development, build the search index dynamically so local edits reflect immediately
  if (import.meta.env.DEV) {
    const manifest = await getManifest();

    if (devCachedIndex && devCachedManifestVersion === manifest.version) {
      return new Response(JSON.stringify(devCachedIndex), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'ETag': `"${manifest.version}"`,
          'X-Robots-Tag': 'noindex, nofollow'
        }
      });
    }

    const catalog = await listCatalog();
    const index: any[] = [];

    // 1. Index all lecture notes
    for (const subject of catalog) {
      for (const lecture of subject.lectures) {
        const content = await getLectureContent(subject.subject, lecture.folderName);
        if (content) {
          const title = lecture.displayTitle || lecture.name;
          const fullText = cleanHtmlText(content.htmlContent);

          index.push({
            type: 'note',
            title,
            subject: subject.subject,
            folderName: lecture.folderName,
            slug: lecture.slug,
            topicTitle: lecture.topicTitle || '',
            text: fullText,
            snippet: fullText.slice(0, 300)
          });
        }
      }
    }

    // 2. Index all published blog posts
    try {
      const blogPosts = await getPublishedPosts();
      for (const post of blogPosts) {
        const cleanText = cleanHtmlText(post.html);
        index.push({
          type: 'blog',
          title: post.frontmatter.title,
          subject: 'Blog',
          folderName: post.slug,
          slug: post.slug,
          topicTitle: post.frontmatter.description || '',
          text: cleanText,
          snippet: cleanText.slice(0, 300)
        });
      }
    } catch (err: any) {
      console.warn('[search-index] Failed to index blog posts:', err.message);
    }

    try {
      const bits = await getPublishedBits();
      for (const bit of bits) {
        const extra = bit.html ? cleanHtmlText(bit.html) : '';
        const fullText = [bit.frontmatter.text, bit.frontmatter.title, bit.frontmatter.imageAlt, bit.frontmatter.link?.title, extra]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        index.push({
          type: 'bit',
          title: bitPreview(bit),
          subject: 'Bits',
          folderName: bit.slug,
          slug: bit.slug,
          topicTitle: bit.frontmatter.link?.title || '',
          text: fullText,
          snippet: fullText.slice(0, 300),
        });
      }
    } catch (err: any) {
      console.warn('[search-index] Failed to index bits:', err.message);
    }

    devCachedIndex = index;
    devCachedManifestVersion = manifest.version;

    return new Response(JSON.stringify(index), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'ETag': `"${manifest.version}"`,
        'X-Robots-Tag': 'noindex, nofollow'
      }
    });
  }

  // In production, fetch the pre-compiled search-index.json from R2
  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[search-index] NOTES_BUCKET binding not found.');
    return new Response(JSON.stringify({ error: 'R2 bucket binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const obj = await bucket.get('search-index.json');
    if (!obj) {
      console.warn('[search-index] search-index.json not found in R2 bucket.');
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawIndex = await obj.json() as any[];
    // Serve the index with full text for client-side deep search
    const safeIndex = rawIndex.map((item: any) => ({
      type: item.type || 'note',
      title: item.title,
      subject: item.subject,
      folderName: item.folderName,
      slug: item.slug || item.folderName,
      topicTitle: item.topicTitle || '',
      text: item.text || item.snippet || '',
      snippet: item.snippet || (item.text || '').slice(0, 300)
    }));

    // Version the cache by the current manifest version so a content upload
    // invalidates the cached search index (Phase 8.9).
    const manifest = await getManifest();
    return new Response(JSON.stringify(safeIndex), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'ETag': `"${manifest.version}"`,
        'X-Robots-Tag': 'noindex, nofollow'
      }
    });
  } catch (err: any) {
    console.error('[search-index] Error loading index from R2:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to load search index' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

