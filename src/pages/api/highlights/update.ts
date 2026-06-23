/**
 * POST /api/highlights/update
 * { highlightId, noteBody }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, sanitizeString } from '../../../lib/apiHelpers';
import { updateHighlightNote } from '../../../lib/highlights';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = await getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['highlightId']);
  if (missing) return badRequest(missing);

  const noteBody = typeof body.noteBody === 'string' ? body.noteBody : '';

  await updateHighlightNote(env.DB, user.id, body.highlightId as string, noteBody);
  return json({ success: true });
};
