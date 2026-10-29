/**
 * GET /api/chatbot/usage
 * Returns current user's chatbot usage for the current calendar month.
 * Used by the frontend to display remaining message count.
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';
import { DEFAULT_MONTHLY_LIMIT, getChatbotUsage } from '../../../lib/chatbotUsage';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = (locals as any).user;
  const isAdmin = Boolean((locals as any).isAdmin);

  if (!user) {
    return new Response(JSON.stringify({
      error: 'Not authenticated',
      used: 0,
      limit: DEFAULT_MONTHLY_LIMIT,
      remaining: DEFAULT_MONTHLY_LIMIT,
      unlimited: false,
      isAdmin: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const env = await getEnv();
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({
      used: 0,
      limit: isAdmin ? null : DEFAULT_MONTHLY_LIMIT,
      remaining: isAdmin ? null : DEFAULT_MONTHLY_LIMIT,
      unlimited: isAdmin,
      isAdmin,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const usage = await getChatbotUsage(db, user.id, isAdmin);
    return new Response(JSON.stringify(usage), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[chatbot/usage] DB error:', err);
    return new Response(JSON.stringify({
      used: 0,
      limit: isAdmin ? null : DEFAULT_MONTHLY_LIMIT,
      remaining: isAdmin ? null : DEFAULT_MONTHLY_LIMIT,
      unlimited: isAdmin,
      isAdmin,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
