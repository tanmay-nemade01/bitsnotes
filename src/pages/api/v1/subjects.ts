import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listSubjects } from '../../../utils/notesLoader';
import { v1CorsHeaders, v1OptionsResponse, checkApiKey } from '../../../lib/cors';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  const corsHeaders = v1CorsHeaders(request, baseUrl);

  if (!checkApiKey(request, (env as any).API_SECRET_KEY)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }),
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const subjects = await listSubjects();
    const result = subjects.map(s => ({
      name: s.name,
      lectureCount: s.lectureCount,
      slug: encodeURIComponent(s.name)
    }));
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve subjects' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  return v1OptionsResponse(request, baseUrl);
};
