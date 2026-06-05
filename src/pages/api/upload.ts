import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { invalidateCache } from '../../utils/r2Structure';

export const PUT: APIRoute = async ({ request, url }) => {
  try {
    const authorization = request.headers.get('Authorization');
    // Retrieve UPLOAD_SECRET from wrangler environment variables
    const expectedSecret = env.UPLOAD_SECRET;

    if (!expectedSecret) {
      console.error("[Upload API] UPLOAD_SECRET is not set in wrangler environment variables.");
      return new Response('Server configuration error: UPLOAD_SECRET is not set', { status: 500 });
    }

    if (authorization !== `Bearer ${expectedSecret}`) {
      console.warn("[Upload API] Unauthorized upload attempt.");
      return new Response('Unauthorized', { status: 401 });
    }

    const key = url.searchParams.get('key');
    if (!key) {
      return new Response('Missing "key" query parameter', { status: 400 });
    }

    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
    const bucket = env.BUCKET;

    if (!bucket) {
      console.error("[Upload API] R2 BUCKET binding is missing.");
      return new Response('Cloudflare R2 BUCKET binding not configured', { status: 500 });
    }

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return new Response('Empty body received', { status: 400 });
    }

    console.log(`[Upload API] Uploading key: "${key}", size: ${body.byteLength} bytes, content-type: "${contentType}"`);

    // Put object in R2 bucket using internal binding
    await (bucket as any).put(key, body, {
      httpMetadata: { contentType }
    });

    // Invalidate cached lists in KV to reflect the new uploads
    const kv = env.SESSION;
    if (kv) {
      await invalidateCache(kv, key);
    }


    return new Response(
      JSON.stringify({ success: true, key }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error(`[Upload API] Internal error: ${error.message || error}`);
    return new Response(`Upload error: ${error.message || error}`, { status: 500 });
  }
};
