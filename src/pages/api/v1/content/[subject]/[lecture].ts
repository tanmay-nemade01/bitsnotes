import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getLectureContent } from '../../../../../utils/notesLoader';
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

  const subject = params.subject ? decodeURIComponent(params.subject) : '';
  const lecture = params.lecture ? decodeURIComponent(params.lecture) : '';

  if (!subject || !lecture) {
    return new Response(
      JSON.stringify({ error: 'Subject and lecture parameters are required' }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const content = await getLectureContent(subject, lecture);
    if (!content) {
      return new Response(
        JSON.stringify({ error: `Lecture not found for ${subject}/${lecture}` }),
        { status: 404, headers: corsHeaders }
      );
    }
    return new Response(JSON.stringify(content), { status: 200, headers: corsHeaders });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve lecture content' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  return v1OptionsResponse(request, baseUrl);
};
