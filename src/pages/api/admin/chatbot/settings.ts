/**
 * Admin Chatbot Settings API
 *
 * GET    /api/admin/chatbot/settings → current model + defaults
 * POST   /api/admin/chatbot/settings → { model } persist selection
 * DELETE /api/admin/chatbot/settings → reset to defaults
 *
 * Requires login + admin_users membership. Mutations are same-origin only.
 */

import type { APIContext, APIRoute } from 'astro';
import {
  getEnv,
  getUser,
  json,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from '../../../../lib/apiHelpers';
import { isAdmin } from '../../../../lib/comments';
import { validateOrigin, csrfForbidden } from '../../../../lib/auth/csrf';
import {
  DEFAULT_CHATBOT_MODELS,
  clearChatbotModel,
  getChatbotModel,
  isValidModelId,
  setChatbotModel,
} from '../../../../lib/chatbotSettings';
import { fetchOpenRouterTextModels } from '../../../../lib/openrouterModels';

export const prerender = false;

async function requireAdmin(context: APIContext) {
  const env = await getEnv(context);
  const user = getUser(context);
  if (!user) return { error: unauthorized() };
  if (!env.DB || !(await isAdmin(env.DB, user.id))) return { error: forbidden() };
  return { env, user };
}

export const GET: APIRoute = async (context) => {
  const { env, error } = await requireAdmin(context);
  if (error) return error;

  try {
    const config = await getChatbotModel(env!.DB);
    return json(
      {
        model: config.model,
        effectiveModel: config.models[0] || null,
        models: config.models,
        isDefault: config.isDefault,
        defaults: DEFAULT_CHATBOT_MODELS,
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (err) {
    console.error('[admin/chatbot/settings] GET failed:', err);
    return serverError('Could not load chatbot settings.');
  }
};

export const POST: APIRoute = async (context) => {
  const { env, user, error } = await requireAdmin(context);
  if (error) return error;

  if (!validateOrigin(context.request, env!.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: { model?: unknown };
  try {
    body = (await context.request.json()) as { model?: unknown };
  } catch {
    return badRequest('Invalid request body.');
  }

  if (!isValidModelId(body.model)) {
    return badRequest('A valid OpenRouter model id is required.');
  }

  const model = body.model.trim();

  // Verify the selection is a text model when the catalogue is reachable.
  try {
    const available = await fetchOpenRouterTextModels(env!.OPENROUTER_API_KEY);
    if (!available.some((entry) => entry.id === model)) {
      return badRequest('That model is not available as a text model on OpenRouter.');
    }
  } catch (err) {
    // OpenRouter may be temporarily unreachable. The id is still format-valid,
    // and the admin picked it from the catalogue, so allow the save.
    console.warn('[admin/chatbot/settings] Could not verify model against OpenRouter:', err);
  }

  try {
    await setChatbotModel(env!.DB, model, user!.id);
    return json({ success: true, model });
  } catch (err) {
    console.error('[admin/chatbot/settings] POST failed:', err);
    return serverError('Could not save the chatbot model.');
  }
};

export const DELETE: APIRoute = async (context) => {
  const { env, error } = await requireAdmin(context);
  if (error) return error;

  if (!validateOrigin(context.request, env!.APP_BASE_URL)) {
    return csrfForbidden();
  }

  try {
    await clearChatbotModel(env!.DB);
    return json({ success: true, model: null, isDefault: true });
  } catch (err) {
    console.error('[admin/chatbot/settings] DELETE failed:', err);
    return serverError('Could not reset the chatbot model.');
  }
};
