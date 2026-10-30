import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCatalog, getLectureContent, getManifest } from '../utils/notesLoader';
import { getPublishedPosts } from '../utils/blogLoader';
import { getPublishedBits, bitPreview } from '../utils/bitsLoader';
import { getEnv } from '../lib/apiHelpers';
import {
  getHiddenSubjectNames,
  computeHiddenFingerprint,
  SubjectVisibilityUnavailableError,
} from '../lib/subjectVisibility';
import { toPublicSearchItem } from '../utils/searchEngine';

export const prerender = false;

let devCachedIndex: any[] | null = null;
let devCachedManifestVersion: string | null = null;

function extractSearchableNoteText(html: string, topicTitle?: string): { text: string; snippet: string } {
  const parts: string[] = [];
  if (topicTitle) parts.push(topicTitle);

  const kwMatch = html.match(/<meta\s+name=["']keywords["']\s+content=["']([\s\S]*?)["']/i);
  if (kwMatch && kwMatch[1]) parts.push(kwMatch[1]);

  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i);
  if (descMatch && descMatch[1]) parts.push(descMatch[1]);

  const metaMatch = html.match(/<script\s+[^>]*id=["']lecture-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1].trim());
      if (Array.isArray(meta.sections)) {
        for (const sec of meta.sections) {
          if (sec.title) parts.push(sec.title);
        }
      }
    } catch {}
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const snippet = (descMatch && descMatch[1]) || (parts.length > 0 ? parts[0] : '');

  return { text, snippet: snippet.slice(0, 300) };
}

function cleanHtmlText(html: string): string {
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, ' ').trim();
}

export const GET: APIRoute = async (context) => {
  const envBinding = await getEnv(context).catch(() => null);
  const isAdmin = Boolean((context.locals as any).isAdmin);

  let hiddenSubjects: Set<string>;
  try {
    hiddenSubjects = await getHiddenSubjectNames(envBinding?.DB);
  } catch (err) {
    if (err instanceof SubjectVisibilityUnavailableError) {
      if (isAdmin) {
        hiddenSubjects = new Set();
      } else {
        return new Response(JSON.stringify({ error: 'Subject visibility unavailable' }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        });
      }
    } else {
      throw err;
    }
  }

  const hiddenFingerprint = await computeHiddenFingerprint(hiddenSubjects);

  function filterForViewer(items: any[]) {
    if (isAdmin || hiddenSubjects.size === 0) return items;
    return items.filter((item) => !item.subject || !hiddenSubjects.has(item.subject));
  }

  // In development, build the search index dynamically so local edits reflect immediately
  if (import.meta.env.DEV) {
    const manifest = await getManifest();

    if (devCachedIndex && devCachedManifestVersion === manifest.version) {
      const filtered = filterForViewer(devCachedIndex);
      return new Response(JSON.stringify(filtered), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'ETag': `"${manifest.version}-${isAdmin ? 'admin' : 'public'}-${hiddenFingerprint}"`,
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }

    const catalog = await listCatalog();
    const index: any[] = [];

    // 1. Index all lecture notes with lightweight metadata & concepts
    for (const subject of catalog) {
      for (const lecture of subject.lectures) {
        const content = await getLectureContent(subject.subject, lecture.folderName);
        if (content) {
          const title = lecture.displayTitle || lecture.name;
          const { text, snippet } = extractSearchableNoteText(content.htmlContent, lecture.topicTitle);

          index.push({
            type: 'note',
            indexVersion: 2,
            title,
            subject: subject.subject,
            folderName: lecture.folderName,
            slug: lecture.slug,
            topicTitle: lecture.topicTitle || '',
            text,
            snippet,
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
          snippet: cleanText.slice(0, 300),
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

    return new Response(JSON.stringify(filterForViewer(index)), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'ETag': `"${manifest.version}-${isAdmin ? 'admin' : 'public'}-${hiddenFingerprint}"`,
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  // In production, fetch the pre-compiled search-index.json from R2
  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[search-index] NOTES_BUCKET binding not found.');
    return new Response(JSON.stringify({ error: 'R2 bucket binding not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const manifest = await getManifest();

    const cache = typeof caches !== 'undefined' && (caches as any)?.default
      ? ((caches as any).default as Cache)
      : ((globalThis as any)?.caches?.default as Cache | undefined);
    const cacheKey = new Request(
      `https://bitsnotes.com/__cache/search-index/${encodeURIComponent(manifest.version)}-${isAdmin ? 'admin' : 'public'}-${hiddenFingerprint}.json`,
    );
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      } catch { /* cache read is best-effort */ }
    }

    const obj = await bucket.get('search-index.json');
    if (!obj) {
      console.warn('[search-index] search-index.json not found in R2 bucket.');
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawIndex = (await obj.json()) as any[];
    const rawMapped = rawIndex.map(toPublicSearchItem);

    const safeIndex = filterForViewer(rawMapped);

    const response = new Response(JSON.stringify(safeIndex), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'ETag': `"${manifest.version}-${isAdmin ? 'admin' : 'public'}-${hiddenFingerprint}"`,
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });

    if (cache) {
      try {
        cache.put(cacheKey, response.clone()).catch(() => {});
      } catch { /* cache write is best-effort */ }
    }

    return response;
  } catch (err: any) {
    console.error('[search-index] Error loading index from R2:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to load search index' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
