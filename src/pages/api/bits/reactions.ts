import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { getReactionState, getReactionStates, isAllowedBitEmoji, toggleBitReaction } from '../../../lib/bitReactions';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

const MAX_SLUGS = 50;

function parseSlugs(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw.split(',').map((s) => sanitizeString(s, 200)).filter((s): s is string => Boolean(s));
  return [...new Set(parts)].slice(0, MAX_SLUGS);
}

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const user = getUser(context);
  const userId = user?.id ?? null;

  const slugsParam = context.url.searchParams.get('slugs');
  if (slugsParam) {
    const slugs = parseSlugs(slugsParam);
    const bits = await getReactionStates(env.DB, slugs, userId);
    return json({ bits });
  }

  const slug = sanitizeString(context.url.searchParams.get('slug'), 200);
  if (!slug) return badRequest('Missing slug');
  const state = await getReactionState(env.DB, slug, userId);
  return json(state);
};

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized('Sign in to react');

  const env = await getEnv(context);
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON');
  }

  const slug = sanitizeString(body.slug, 200);
  const emoji = sanitizeString(body.emoji, 16);
  if (!slug) return badRequest('Missing slug');
  if (!emoji || !isAllowedBitEmoji(emoji)) return badRequest('Invalid emoji');

  const result = await toggleBitReaction(env.DB, user.id, slug, emoji);
  return json(result);
};
