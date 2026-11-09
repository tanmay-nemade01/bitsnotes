/**
 * GET /api/chatbot/usage
 *
 * Intentionally returns no quota details. The chatbot fair-use threshold is
 * managed internally and must not be discoverable from the client.
 *
 * This endpoint is kept as a lightweight compatibility stub for older cached
 * clients. It will be removed once the deprecated usage UI has fully aged out.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
