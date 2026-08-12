/**
 * GET /api/chatbot/usage
 * Returns current user's chatbot usage for today.
 * Used by the frontend to display remaining message count.
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';

export const prerender = false;

const DAILY_LIMIT = 20;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated', used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const env = await getEnv();
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const today = utcDateString();
    const row = await db.prepare(
      'SELECT message_count FROM chatbot_usage WHERE user_id = ? AND usage_date = ?'
    ).bind(user.id, today).first<{ message_count: number }>();

    const used = row?.message_count ?? 0;

    return new Response(JSON.stringify({
      used,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - used),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[chatbot/usage] DB error:', err);
    return new Response(JSON.stringify({ used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
