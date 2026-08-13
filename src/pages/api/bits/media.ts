import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { badRequest, notFound } from '../../../lib/apiHelpers';
import { getLocalSvgMarkup } from '../../../utils/bitsLoader';

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

function globValue<T>(glob: Record<string, T>, slug: string, file: string): T | undefined {
  const suffix = `/bits/${slug}/${file}`;
  for (const [key, value] of Object.entries(glob)) {
    const normalized = key.replace(/\\/g, '/');
    if (normalized.endsWith(suffix) || normalized === `/src/content/bits/${slug}/${file}`) {
      return value;
    }
  }
  return undefined;
}

export const GET: APIRoute = async (context) => {
  const slug = context.url.searchParams.get('slug') ?? '';
  const file = context.url.searchParams.get('file') ?? '';
  if (!isSafeSegment(slug) || !isSafeSegment(file)) {
    return badRequest('Invalid media path');
  }

  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const contentType = ALLOWED_EXT[ext];
  if (!contentType) {
    return notFound();
  }

  const localSvg = getLocalSvgMarkup(slug, file);
  if (typeof localSvg === 'string') {
    return new Response(localSvg, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const svg = globValue(svgGlob, slug, file);
  if (typeof svg === 'string') {
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const bundledUrl = globValue(urlGlob, slug, file);
  if (bundledUrl) {
    return Response.redirect(new URL(bundledUrl, context.url.origin).href, 302);
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    return notFound();
  }

  try {
    const obj = await bucket.get(`bits/${slug}/${file}`);
    if (!obj) return notFound();
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return notFound();
  }
};
