import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const ALLOWED_EXT: Record<string, string> = {
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const svgGlob = import.meta.glob<string>(
  '/src/content/bits/*/*.svg',
  { eager: true, query: '?raw', import: 'default' },
);

const urlGlob = import.meta.glob<string>(
  '/src/content/bits/*/*.{png,jpg,jpeg,webp,gif}',
  { eager: true, query: '?url', import: 'default' },
);

function isSafeSegment(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes('..');
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  const file = params.file ?? '';
  if (!isSafeSegment(slug) || !isSafeSegment(file)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const contentType = ALLOWED_EXT[ext];
  if (!contentType) {
    return new Response('Not found', { status: 404 });
  }

  const globKey = `/src/content/bits/${slug}/${file}`;
  const svg = svgGlob[globKey];
  if (typeof svg === 'string') {
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const bundledUrl = urlGlob[globKey];
  if (bundledUrl) {
    return Response.redirect(bundledUrl, 302);
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const obj = await bucket.get(`bits/${slug}/${file}`);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
