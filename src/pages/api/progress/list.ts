/**
 * GET /api/progress/list?subject=...
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { listProgress, getProgressSummary } from '../../../lib/progress';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const url = new URL(context.request.url);
  const subject = url.searchParams.get('subject');

  const env = getEnv(context);

  if (subject) {
    const normalized = sanitizeString(subject, 200);
    if (!normalized) return badRequest('Invalid subject');
    const progress = await listProgress(env.DB, user.id, normalized);
    return json({ lectures: progress });
  }

  // No subject = return summary across all subjects
  const summary = await getProgressSummary(env.DB, user.id);
  return json({ summary });
};
