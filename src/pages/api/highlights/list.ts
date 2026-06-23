/**
 * GET /api/highlights/list?subject=...&lecture=...
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { listHighlights } from '../../../lib/highlights';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const url = new URL(context.request.url);
  const subject = sanitizeString(url.searchParams.get('subject'), 200);
  const lecture = sanitizeString(url.searchParams.get('lecture'), 200);

  if (!subject || !lecture) return badRequest('subject and lecture required');

  const env = await getEnv(context);
  const highlights = await listHighlights(env.DB, user.id, subject, lecture);
  return json({ highlights });
};
