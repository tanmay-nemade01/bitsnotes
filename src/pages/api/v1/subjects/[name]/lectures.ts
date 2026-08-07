import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listLectures } from '../../../../../utils/notesLoader';
import { v1CorsHeaders, v1OptionsResponse, checkApiKey } from '../../../../../lib/cors';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  const corsHeaders = v1CorsHeaders(request, baseUrl);

  if (!checkApiKey(request, (env as any).API_SECRET_KEY)) {
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
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve lectures' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  return v1OptionsResponse(request, baseUrl);
};
