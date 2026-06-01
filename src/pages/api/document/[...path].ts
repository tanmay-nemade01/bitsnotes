import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params }) => {
  // path captures everything: "Subject/Lecture Name/page_001.webp"
  const { path } = params;

  if (!path) {
    return new Response('Missing document path parameter', { status: 400 });
  }

  // Decode all segments and reconstruct the R2 key
  const key = path.split('/').map(decodeURIComponent).join('/');

  const bucket = env.BUCKET;

  if (!bucket) {
    return new Response('Cloudflare R2 BUCKET binding not configured', { status: 500 });
  }

  try {
    const object = await (bucket as any).get(key);

    if (!object) {
      return new Response('Document page image not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);

    // Security and caching headers
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return new Response(`Error retrieving file: ${error.message || error}`, { status: 500 });
  }
};
