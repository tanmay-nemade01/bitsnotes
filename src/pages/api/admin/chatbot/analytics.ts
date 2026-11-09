/**
 * Admin Chatbot Analytics API
 *
 * GET /api/admin/chatbot/analytics?days=30
 *
 * Returns aggregate chatbot usage and token consumption for the last N days
 * (UTC). Token counts are captured per successful request from the upstream
 * OpenRouter response in `chatbot_requests.prompt_tokens` /
 * `completion_tokens`.
 *
 * Requires login + admin_users membership.
 */

import type { APIContext, APIRoute } from 'astro';
import { getEnv, getUser, json, unauthorized, forbidden, serverError } from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';

export const prerender = false;

interface DayRow {
  day: string;
  requests: number;
  successful: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface ModelRow {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface UserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
}

function toInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export const GET: APIRoute = async (context: APIContext) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!env.DB || !(await isAdmin(env.DB, user.id))) return forbidden();

  const requested = Number(context.url.searchParams.get('days') || '30');
  const days = Math.min(90, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 30));

  const now = Date.now();
  const startMs = now - days * 24 * 60 * 60 * 1000;

  try {
    const dailyResult = await env.DB.prepare(
      `SELECT
         strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
         COUNT(*) AS requests,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN status = 'success' THEN COALESCE(prompt_tokens, 0) ELSE 0 END) AS prompt_tokens,
         SUM(CASE WHEN status = 'success' THEN COALESCE(completion_tokens, 0) ELSE 0 END) AS completion_tokens
       FROM chatbot_requests
       WHERE created_at >= ?
       GROUP BY day
       ORDER BY day ASC`
    )
      .bind(startMs)
      .all<DayRow>();

    const modelResult = await env.DB.prepare(
      `SELECT
         COALESCE(model, 'unknown') AS model,
         COUNT(*) AS requests,
         SUM(COALESCE(prompt_tokens, 0)) AS prompt_tokens,
         SUM(COALESCE(completion_tokens, 0)) AS completion_tokens
       FROM chatbot_requests
       WHERE created_at >= ? AND status = 'success'
       GROUP BY model
       ORDER BY (SUM(COALESCE(prompt_tokens, 0)) + SUM(COALESCE(completion_tokens, 0))) DESC
       LIMIT 10`
    )
      .bind(startMs)
      .all<ModelRow>();

    const userResult = await env.DB.prepare(
      `SELECT
         r.user_id AS user_id,
         u.email AS email,
         u.display_name AS display_name,
         COUNT(*) AS requests,
         SUM(COALESCE(r.prompt_tokens, 0)) AS prompt_tokens,
         SUM(COALESCE(r.completion_tokens, 0)) AS completion_tokens
       FROM chatbot_requests r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.created_at >= ? AND r.status = 'success'
       GROUP BY r.user_id
       ORDER BY (SUM(COALESCE(r.prompt_tokens, 0)) + SUM(COALESCE(r.completion_tokens, 0))) DESC
       LIMIT 10`
    )
      .bind(startMs)
      .all<UserRow>();

    const daysOut = (dailyResult.results || []).map((row) => ({
      day: row.day,
      requests: toInt(row.requests),
      successful: toInt(row.successful),
      errors: toInt(row.errors),
      promptTokens: toInt(row.prompt_tokens),
      completionTokens: toInt(row.completion_tokens),
      totalTokens: toInt(row.prompt_tokens) + toInt(row.completion_tokens),
    }));

    const totals = daysOut.reduce(
      (acc, row) => {
        acc.requests += row.requests;
        acc.successful += row.successful;
        acc.errors += row.errors;
        acc.promptTokens += row.promptTokens;
        acc.completionTokens += row.completionTokens;
        acc.totalTokens += row.totalTokens;
        return acc;
      },
      { requests: 0, successful: 0, errors: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );

    return json({
      days: daysOut,
      totals: {
        ...totals,
        avgTokensPerRequest: totals.successful > 0 ? Math.round(totals.totalTokens / totals.successful) : 0,
      },
      models: (modelResult.results || []).map((row) => ({
        model: row.model,
        requests: toInt(row.requests),
        promptTokens: toInt(row.prompt_tokens),
        completionTokens: toInt(row.completion_tokens),
        totalTokens: toInt(row.prompt_tokens) + toInt(row.completion_tokens),
      })),
      topUsers: (userResult.results || []).map((row) => ({
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        requests: toInt(row.requests),
        promptTokens: toInt(row.prompt_tokens),
        completionTokens: toInt(row.completion_tokens),
        totalTokens: toInt(row.prompt_tokens) + toInt(row.completion_tokens),
      })),
      windowDays: days,
      generatedAt: now,
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[admin/chatbot/analytics] GET failed:', err);
    return serverError('Could not load chatbot analytics.');
  }
};
