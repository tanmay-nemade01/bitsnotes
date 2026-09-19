/**
 * POST /api/chatbot/chat
 * Server-side proxy for BitsNotes AI chatbot mode.
 * - Requires authenticated user (session cookie)
 * - Enforces 20 messages/day/user via D1 chatbot_usage table
 * - Augments the system prompt with up to 2 related-lecture snippets from
 *   the same subject (lean keyword retrieval, edge-cached, non-fatal) plus
 *   up to 1 per-subject textbook excerpt (opt-out via includeTextbook=false)
 * - Proxies to OpenRouter API with server-side API key
 * - Returns friendly error message on any upstream failure
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';
import {
  buildCompanionBlock,
  buildRelatedBlock,
  getCompanionSnippets,
  getLastUserQuery,
  getRelatedSnippets,
  parseSubjectFromSystemPrompt,
} from '../../../lib/chatbotRetrieval';

export const prerender = false;

const DAILY_LIMIT = 20;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free';

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = (locals as any).user;
  if (!user) {
    return jsonResponse({ error: 'Authentication required. Please sign in to use BitsNotes AI.' }, 401);
  }

  const env = await getEnv();
  const db = env.DB;
  const openrouterKey = env.OPENROUTER_API_KEY;

  if (!db || !openrouterKey) {
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  // ─── Burst rate limiting (10 req/min) ────────────────────────────────
  const rateLimiter = env.CHATBOT_RATE_LIMITER;
  if (rateLimiter) {
    try {
      const rl = await rateLimiter.limit({ key: user.id });
      if (!rl.success) {
        return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 429);
      }
    } catch {
      // Rate limiter unavailable — proceed without burst protection
    }
  }

  // ─── Daily limit check ───────────────────────────────────────────────
  const today = utcDateString();
  let messageCount = 0;

  try {
    const row = await db.prepare(
      'SELECT message_count FROM chatbot_usage WHERE user_id = ? AND usage_date = ?'
    ).bind(user.id, today).first<{ message_count: number }>();
    messageCount = row?.message_count ?? 0;
  } catch (err) {
    console.error('[chatbot/chat] Failed to read usage:', err);
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  if (messageCount >= DAILY_LIMIT) {
    return jsonResponse({
      error: `You've reached your daily limit of ${DAILY_LIMIT} messages. Come back tomorrow!`,
      limitReached: true,
      used: messageCount,
      limit: DAILY_LIMIT,
    }, 429);
  }

  // ─── Parse request body ──────────────────────────────────────────────
  let body: {
    messages?: Array<{ role?: string; content?: unknown }>;
    subject?: string;
    lectureFolder?: string;
    query?: string;
    includeTextbook?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'Messages array is required.' }, 400);
  }

  // ─── Lean retrieval: related lectures + textbook (both non-fatal) ────
  // Client sends explicit subject/folder/query; fall back to parsing the
  // system prompt + last user message for backwards compatibility.
  // Textbook excerpts are on by default; the client toggle sends
  // includeTextbook=false to opt out.
  let subject = (body.subject || '').trim();
  let excludeFolder = (body.lectureFolder || '').trim();
  let query = (body.query || '').trim();
  const includeTextbook = body.includeTextbook !== false;

  const systemMsgForParse = body.messages.find((m) => m?.role === 'system');
  if ((!subject || !excludeFolder) && systemMsgForParse && typeof systemMsgForParse.content === 'string') {
    const parsed = parseSubjectFromSystemPrompt(systemMsgForParse.content);
    if (!subject) subject = parsed.subject;
    if (!excludeFolder) excludeFolder = parsed.lectureFolder;
  }
  if (!query) query = getLastUserQuery(body.messages);

  let relatedBlock = '';
  let companionBlock = '';
  let relatedSources: Array<{ kind: string; title: string; folderName: string; slug: string }> = [];
  try {
    // Independent fetches — run together; each degrades to [] on failure.
    const [lectureSnippets, companionSnippets] = await Promise.all([
      getRelatedSnippets({ subject, excludeFolder, query }),
      includeTextbook
        ? getCompanionSnippets({ subject, query })
        : Promise.resolve([]),
    ]);
    if (lectureSnippets.length > 0) {
      relatedBlock = buildRelatedBlock(lectureSnippets);
      relatedSources = lectureSnippets.map((s) => ({
        kind: 'lecture',
        title: s.title,
        folderName: s.folderName,
        slug: s.slug,
      }));
    }
    if (companionSnippets.length > 0) {
      companionBlock = buildCompanionBlock(companionSnippets);
      for (const s of companionSnippets) {
        relatedSources.push({
          kind: 'textbook',
          title: s.title,
          folderName: s.chapterId,
          slug: s.chapterId,
        });
      }
    }
  } catch (err) {
    // Retrieval must never break chat — fall back to single-lecture context.
    console.error('[chatbot/chat] Related-lecture retrieval failed (non-fatal):', err);
  }

  // Inject related excerpts into a COPY of the system message only.
  const upstreamMessages = body.messages.map((m) => ({ ...m }));
  const extraContext = relatedBlock + companionBlock;
  if (extraContext) {
    const sysIdx = upstreamMessages.findIndex((m) => m?.role === 'system');
    if (sysIdx >= 0 && typeof upstreamMessages[sysIdx].content === 'string') {
      upstreamMessages[sysIdx] = {
        ...upstreamMessages[sysIdx],
        content: (upstreamMessages[sysIdx].content as string) + extraContext,
      };
    } else {
      upstreamMessages.unshift({ role: 'system', content: extraContext.trim() });
    }
  }

  // ─── Proxy to OpenRouter ─────────────────────────────────────────────
  try {
    const orResponse = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://bitsnotes.com',
        'X-Title': 'BitsNotes AI Study Assistant',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: upstreamMessages,
        temperature: 0.3,
      }),
    });

    if (!orResponse.ok) {
      console.error('[chatbot/chat] OpenRouter error:', orResponse.status, await orResponse.text().catch(() => ''));
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    const data = (await orResponse.json()) as Record<string, any>;

    // ─── Increment usage counter on success ──────────────────────────
    try {
      await db.prepare(
        `INSERT INTO chatbot_usage (user_id, usage_date, message_count)
         VALUES (?, ?, 1)
         ON CONFLICT (user_id, usage_date)
         DO UPDATE SET message_count = message_count + 1`
      ).bind(user.id, today).run();
    } catch (err) {
      // Non-fatal: the message was already sent, just log the counting failure
      console.error('[chatbot/chat] Failed to increment usage:', err);
    }

    const newCount = messageCount + 1;

    return jsonResponse({
      ...data,
      _usage: {
        used: newCount,
        limit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - newCount,
      },
      _sources: relatedSources,
    }, 200);
  } catch (err) {
    console.error('[chatbot/chat] Proxy error:', err);
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }
};
