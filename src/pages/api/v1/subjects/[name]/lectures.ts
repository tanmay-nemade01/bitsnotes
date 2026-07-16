import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listLectures } from '../../../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  const authHeader = request.headers.get('Authorization') || request.headers.get('x-api-key');
  const expectedKey = (env as any).API_SECRET_KEY;

  if (!expectedKey || !authHeader || (authHeader !== `Bearer ${expectedKey}` && authHeader !== expectedKey)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const subjectName = params.name ? decodeURIComponent(params.name) : '';
  if (!subjectName) {
    return new Response(JSON.stringify({ error: 'Subject parameter is required' }), { status: 400, headers: corsHeaders });
  }

  try {
    const lectures = await listLectures(subjectName);
    const result = lectures.map((l: any) => ({
      name: l.name,
      folderName: l.folderName,
      slug: l.slug
    }));
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to retrieve lectures' }),
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
