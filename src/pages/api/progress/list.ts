/**
 * GET /api/progress/list?subject=...
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, sanitizeString } from '../../../lib/apiHelpers';
import { listProgress, getProgressSummary, listTopicProgress } from '../../../lib/progress';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const url = new URL(context.request.url);
  const subject = url.searchParams.get('subject');
  const lecture = url.searchParams.get('lecture');

  const env = await getEnv(context);

  if (subject) {
    const normalized = sanitizeString(subject, 200);
    if (!normalized) return badRequest('Invalid subject');
    const progress = await listProgress(env.DB, user.id, normalized);
    
    let topicProgress: any[] = [];
    if (lecture) {
      const normalizedLec = sanitizeString(lecture, 200);
      if (normalizedLec) {
        topicProgress = await listTopicProgress(env.DB, user.id, normalized, normalizedLec);
      }
    }
    return json({ lectures: progress, topicProgress });
  }

  // No subject = return summary across all subjects
  const summary = await getProgressSummary(env.DB, user.id);
  return json({ summary });
};
