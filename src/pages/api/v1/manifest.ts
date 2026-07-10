import type { APIRoute } from 'astro';
import { getManifest } from '../../../utils/notesLoader';

export const prerender = false;

export const GET: APIRoute = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
};
