import type { APIRoute } from 'astro';
import { listSubjects } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const subjects = await listSubjects();
    const result = subjects.map(s => ({
      name: s.name,
      lectureCount: s.lectureCount,
      slug: encodeURIComponent(s.name)
    }));
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to retrieve subjects' }),
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
