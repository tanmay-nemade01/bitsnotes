/**
 * POST /api/chatbot/chat
 * Server-side proxy for BitsNotes AI chatbot mode.
 * - Requires authenticated user (session cookie)
 * - Enforces 20 messages/day/user via D1 chatbot_usage table
 * - Proxies to OpenRouter API with server-side API key
 * - Returns friendly error message on any upstream failure
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';

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
  let body: { messages?: any[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'Messages array is required.' }, 400);
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
        messages: body.messages,
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
    }, 200);
  } catch (err) {
    console.error('[chatbot/chat] Proxy error:', err);
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }
};
