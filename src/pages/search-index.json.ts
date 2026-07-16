import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCatalog, getLectureContent, getManifest } from '../utils/notesLoader';

export const prerender = false;

function cleanHtmlText(html: string): string {
  // Strip style tags and content
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  // Strip script tags and content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  // Strip head tags and content
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  // Strip iframe tags and content
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

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
    const catalog = await listCatalog();
    const manifest = await getManifest();
    const index = [];

    for (const subject of catalog) {
      for (const lecture of subject.lectures) {
        const content = await getLectureContent(subject.subject, lecture.folderName);
        if (content) {
          const title = lecture.displayTitle || lecture.name;
          const fullText = cleanHtmlText(content.htmlContent);

          index.push({
            title,
            subject: subject.subject,
            folderName: lecture.folderName,
            slug: lecture.slug,
            snippet: fullText.slice(0, 300)
          });
        }
      }
    }

    return new Response(JSON.stringify(index), {
      headers: {
        'Content-Type': 'application/json',
        // Versioned by manifest version; public cache so the client can reuse
        // the index across navigations (Phase 8.9). Snippets are already
        // truncated to 300 chars to limit bulk content exposure.
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
    // Truncate text to snippets to prevent bulk content scraping
    const safeIndex = rawIndex.map((item: any) => ({
      title: item.title,
      subject: item.subject,
      folderName: item.folderName,
      slug: item.slug || item.folderName,
      snippet: (item.text || item.snippet || '').slice(0, 300)
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
