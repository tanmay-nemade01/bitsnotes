import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params }) => {
  const { id, page } = params;
  
  if (!id || !page) {
    return new Response('Missing document ID or page parameter', { status: 400 });
  }

  // Decode the URL parameters to match the actual folder and file names in R2
  const decodedId = decodeURIComponent(id);
  const decodedPage = decodeURIComponent(page);

  // Retrieve the Cloudflare R2 bucket binding directly from workers env
  const bucket = env.BUCKET;
  
  if (!bucket) {
    return new Response('Cloudflare R2 BUCKET binding not configured', { status: 500 });
  }

  try {
    const key = `${decodedId}/${decodedPage}`;
    const object = await (bucket as any).get(key);

    if (!object) {
      return new Response('Document page image not found', { status: 404 });
    }

    const headers = new Headers();
    // Copy content type and other metadata from the R2 object
    object.writeHttpMetadata(headers);
    
    // Add security and optimization headers
    headers.set('Access-Control-Allow-Origin', '*');
    // Cache the image for 1 year (immutable) so browsers render it instantly on re-visits
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return new Response(`Error retrieving file: ${error.message || error}`, { status: 500 });
  }
};
