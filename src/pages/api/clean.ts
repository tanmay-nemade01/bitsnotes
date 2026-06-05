import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { invalidateAllCaches } from '../../utils/r2Structure';

export const POST: APIRoute = async ({ request }) => {
  try {
    const authorization = request.headers.get('Authorization');
    const expectedSecret = env.UPLOAD_SECRET;

    if (!expectedSecret) {
      console.error("[Clean API] UPLOAD_SECRET is not set in wrangler environment variables.");
      return new Response('Server configuration error: UPLOAD_SECRET is not set', { status: 500 });
    }

    if (authorization !== `Bearer ${expectedSecret}`) {
      console.warn("[Clean API] Unauthorized clean attempt.");
      return new Response('Unauthorized', { status: 401 });
    }

    const bucket = env.BUCKET;
    if (!bucket) {
      console.error("[Clean API] R2 BUCKET binding is missing.");
      return new Response('Cloudflare R2 BUCKET binding not configured', { status: 500 });
    }

    console.log("[Clean API] Starting bucket cleanup...");

    // List and delete all objects in the bucket
    let truncated = true;
    let cursor: string | undefined = undefined;
    let count = 0;

    while (truncated) {
      const options: any = { limit: 100 };
      if (cursor) {
        options.cursor = cursor;
      }
      
      const listResult = await (bucket as any).list(options);
      
      if (listResult.objects && listResult.objects.length > 0) {
        for (const obj of listResult.objects) {
          console.log(`[Clean API] Deleting object: "${obj.key}"`);
          await (bucket as any).delete(obj.key);
          count++;
        }
      }

      truncated = listResult.truncated;
      cursor = listResult.cursor;
    }

    console.log(`[Clean API] Cleanup complete. Deleted ${count} objects.`);

    // Invalidate all cached lists in KV since the bucket is now empty
    const kv = env.SESSION;
    if (kv) {
      await invalidateAllCaches(kv);
    }


    return new Response(
      JSON.stringify({ success: true, deletedCount: count }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error(`[Clean API] Cleanup error: ${error.message || error}`);
    return new Response(`Clean error: ${error.message || error}`, { status: 500 });
  }
};
