import type { APIRoute } from 'astro';
import { getLectureContent } from '../../../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

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
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to retrieve lecture content' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
};
