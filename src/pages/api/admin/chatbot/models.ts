/**
 * Admin Chatbot Models API
 *
 * GET /api/admin/chatbot/models
 *   → { models, total, freeCount, fetchedAt }
 *
 * Fetches the OpenRouter catalogue and returns text-output models only. Free
 * models are included and flagged with `isFree`.
 *
 * Requires login + admin_users membership.
 */

import type { APIRoute } from 'astro';
import {
  getEnv,
  getUser,
  json,
  unauthorized,
  forbidden,
  serverError,
} from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { fetchOpenRouterTextModels } from '../../../../lib/openrouterModels';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return unauthorized();
  if (!env.DB) return serverError('Database unavailable.');
  if (!(await isAdmin(env.DB, user.id))) return forbidden();

  const params = new URL(context.request.url).searchParams;
  const freeOnly = params.get('free') === '1';

  try {
    const allModels = await fetchOpenRouterTextModels(env.OPENROUTER_API_KEY);
    const models = freeOnly ? allModels.filter((model) => model.isFree) : allModels;

    return json(
      {
        models,
        total: models.length,
        freeCount: allModels.filter((model) => model.isFree).length,
        fetchedAt: Date.now(),
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (err) {
    console.error('[admin/chatbot/models] Failed to load OpenRouter models:', err);
    return serverError('Could not load models from OpenRouter. Please try again.');
  }
};
