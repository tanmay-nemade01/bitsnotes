/**
 * POST /api/highlights/save
 * { subject, lecture, selectorPath, startOffset, endOffset, noteBody?, color? }
 */

import type { APIRoute } from 'astro';
import { getEnv, json, unauthorized, badRequest, getUser, validateFields, sanitizeString, getClientIp } from '../../../lib/apiHelpers';
import { saveHighlight } from '../../../lib/highlights';
import { logAuthEvent } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized();

  const env = getEnv(context);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return badRequest('Invalid JSON'); }

  const missing = validateFields(body, ['subject', 'lecture', 'selectorPath']);
  if (missing) return badRequest(missing);

  if (typeof body.startOffset !== 'number' || typeof body.endOffset !== 'number') {
    return badRequest('startOffset and endOffset must be numbers');
  }

  try {
    const highlight = await saveHighlight(env.DB, user.id, {
      subject: sanitizeString(body.subject, 200)!,
      lecture: sanitizeString(body.lecture, 200)!,
      selectorPath: body.selectorPath as string,
      startOffset: body.startOffset,
      endOffset: body.endOffset,
      noteBody: typeof body.noteBody === 'string' ? body.noteBody : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
    });

    await logAuthEvent(env.DB, { userId: user.id, event: 'highlight_save', ip: getClientIp(context.request), ua: context.request.headers.get('User-Agent') || '' });
    return json({ success: true, highlight });
  } catch (err: any) {
    return badRequest(err?.message || 'Failed to save highlight');
  }
};
