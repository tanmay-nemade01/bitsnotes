/**
 * GET /api/chatbot/companion?subject=<Subject Name>&query=<question>
 * Public helper for BYOK mode (client-direct provider calls bypass the
 * server chat proxy, so the client fetches textbook context itself and
 * appends the returned block to its system prompt).
 *
 * - No login required (BYOK users may be logged out)
 * - Burst-protected by IP via CHATBOT_RATE_LIMITER (best-effort)
 * - Returns at most 1 query-centered excerpt (~1500 chars) scoped to the
 *   requested subject; never throws a hard error — returns {snippets: []}
 *   when nothing is available so chat degrades gracefully.
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';
import {
  buildCompanionBlock,
  getCompanionSnippets,
} from '../../../lib/chatbotRetrieval';

export const prerender = false;

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const env = await getEnv();

  // ─── Burst rate limiting by IP (best-effort, public endpoint) ─────────
  const rateLimiter = (env as any).CHATBOT_RATE_LIMITER as
    | { limit: (opts: { key: string }) => Promise<{ success: boolean }> }
    | undefined;
  if (rateLimiter) {
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      'unknown';
    try {
      const rl = await rateLimiter.limit({ key: `companion:${ip}` });
      if (!rl.success) {
        return jsonResponse({ snippets: [], block: '', rateLimited: true }, 429);
      }
    } catch {
      // Rate limiter unavailable — proceed without burst protection
    }
  }

  const url = new URL(request.url);
  const subject = (url.searchParams.get('subject') || '').trim().slice(0, 200);
  const query = (url.searchParams.get('query') || '').trim().slice(0, 1000);

  if (!subject || !query) {
    return jsonResponse({ snippets: [], block: '' }, 200);
  }

  try {
    const snippets = await getCompanionSnippets({ subject, query });
    return jsonResponse(
      {
        snippets: snippets.map((s) => ({
          kind: 'textbook',
          title: s.title,
          folderName: s.chapterId,
          slug: s.chapterId,
        })),
        block: buildCompanionBlock(snippets),
      },
      200
    );
  } catch (err) {
    console.error('[chatbot/companion] Non-fatal failure:', err);
    return jsonResponse({ snippets: [], block: '' }, 200);
  }
};
