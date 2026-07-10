import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getManifest } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  const authHeader = request.headers.get('Authorization') || request.headers.get('x-api-key');
  const expectedKey = (env as any).API_SECRET_KEY || 'default-bitsnotes-mobile-app-key-2026';

  if (!authHeader || (authHeader !== `Bearer ${expectedKey}` && authHeader !== expectedKey)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }),
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const manifest = await getManifest();
    return new Response(
      JSON.stringify({
        version: manifest.version,
        subjects_count: manifest.subjects_count,
        total_lectures: manifest.total_lectures,
        updatedAt: manifest.updatedAt
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to retrieve manifest' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
};
