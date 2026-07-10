import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listSubjects, listLectures, getLectureContent } from '../utils/notesLoader';

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
    const subjects = await listSubjects();
    const index = [];

    for (const subject of subjects) {
      const lectures = await listLectures(subject.name);
      for (const lecture of lectures) {
        const content = await getLectureContent(subject.name, lecture.folderName);
        if (content) {
          const title = content.metadata?.title ? `${lecture.name} — ${content.metadata.title}` : lecture.name;
          const fullText = cleanHtmlText(content.htmlContent);
          
          index.push({
            title,
            subject: subject.name,
            folderName: lecture.folderName,
            snippet: fullText.slice(0, 300)
          });
        }
      }
    }

    return new Response(JSON.stringify(index), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store, max-age=0',
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
      snippet: (item.text || item.snippet || '').slice(0, 300)
    }));
    return new Response(JSON.stringify(safeIndex), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store, max-age=0',
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
