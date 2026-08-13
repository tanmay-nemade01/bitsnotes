/**
 * Comments API (Phase 4).
 *
 * GET  /api/comments            — List published comments (cursor pagination)
 * POST /api/comments            — Create an anonymous comment
 *
 * Query (GET): pageType, subject, lecture (required for lecture pages), cursor, limit (max 20)
 *
 * POST body: pageType, subject, lecture, displayName, body, _website (honeypot),
 *            formStartedAt, turnstileToken
 *
 * POST responses:
 *   201 published | 202 pending | 400 validation | 422 profanity | 429 rate limit | 500 generic
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, tooMany, serverError, getUser } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { verifyTurnstile } from '../../../lib/auth/turnstile';
import { getClientIp } from '../../../lib/apiHelpers';
import { listComments, createComment, resolveParent } from '../../../lib/comments';
import { validateCommentBody, moderateSubmission, MAX_JSON_BYTES, MIN_FILL_MS } from '../../../lib/commentsValidation';
import { listLectures, listSubjects } from '../../../utils/notesLoader';
import { getPublishedPosts } from '../../../utils/blogLoader';
import { sha256Hex } from '../../../lib/auth/crypto';


export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const url = new URL(context.request.url);
  const pageType = url.searchParams.get('pageType');
  const subject = url.searchParams.get('subject');
  const lecture = url.searchParams.get('lecture');
  const cursor = url.searchParams.get('cursor');
  const limitRaw = url.searchParams.get('limit');

  if (pageType !== 'lecture' && pageType !== 'subject' && pageType !== 'blog') {
    return badRequest('pageType must be "lecture", "subject" or "blog"');
  }
  if (!subject) return badRequest('subject is required');
  if (pageType === 'lecture' && !lecture) {
    return badRequest('lecture is required for lecture pages');
  }

  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10) || 20, 20) : 20;

  // Build the set of comment ids the viewer "owns" so the UI can show
  // delete controls. Anonymous owners are identified by their stored delete
  // tokens (passed as a comma-separated `own` list); signed-in users are
  // flagged by their user id.
  const ownIds = new Set<string>();
  const ownParam = url.searchParams.get('own');
  if (ownParam) {
    ownParam.split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => ownIds.add(id));
  }
  const user = getUser(context);
  if (user) {
    // Signed-in ownership is resolved server-side below via author_user_id.
  }

  try {
    const result = await listComments(env.DB, {
      pageType,
      subject,
      lecture: pageType === 'lecture' ? lecture : null,
      cursor: cursor || null,
      limit,
      ownIds: ownIds.size ? ownIds : null,
    });
    return json(result, 200, { 'Cache-Control': 'no-store' });
  } catch (err: any) {
    return json({ error: 'Failed to load comments' }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);

  // CSRF: same-origin only.
  if (!validateOrigin(context.request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  // Cap body size before parse.
  const contentLength = parseInt(context.request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_JSON_BYTES) {
    return badRequest('Payload too large');
  }

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid JSON');
  }

  // Honeypot: if filled, fake success without storing.
  if (typeof body._website === 'string' && body._website.trim() !== '') {
    return json({ success: true, id: null, status: 'published', token: null }, 201);
  }

  // Min fill time (anti-bot).
  const rawStarted = body.formStartedAt;
  const formStartedAt = typeof rawStarted === 'number'
    ? rawStarted
    : (typeof rawStarted === 'string' ? Number(rawStarted) : NaN);
  if (!Number.isFinite(formStartedAt) || Date.now() - formStartedAt < MIN_FILL_MS) {
    // Treat as bot-like: fake success, no store.
    return json({ success: true, id: null, status: 'published', token: null }, 201);
  }

  // Rate limit (Cloudflare Rate Limit binding).
  if (env.COMMENT_RATE_LIMITER) {
    const ip = getClientIp(context.request);
    const { success } = await env.COMMENT_RATE_LIMITER.limit({ key: `c:${ip}` });
    if (!success) return tooMany('Too many comments. Please try again later.');
  }

  // Turnstile (only when secret configured; skipped in local dev where the
  // widget cannot complete a real challenge). Production keeps full enforcement.
  const turnstileSecret = (env as any).TURNSTILE_SECRET_KEY as string | undefined;
  if (turnstileSecret && !import.meta.env.DEV) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!token) return badRequest('Verification required');
    const result = await verifyTurnstile(turnstileSecret, token, getClientIp(context.request));
    if (!result.success) {
      return badRequest('Verification failed. Please try again.');
    }
  }

  // Validate fields.
  const v = validateCommentBody(body);
  if (!v.ok) return badRequest(v.error);

  // Verify subject/lecture/blog exist in manifest/loader.
  if (v.pageType === 'lecture' || v.pageType === 'subject') {
    const subjects = await listSubjects();
    if (!subjects.some((s) => s.name === v.subject)) {
      return badRequest('Unknown subject');
    }
    if (v.pageType === 'lecture') {
      const lectures = await listLectures(v.subject);
      if (!lectures.some((l) => l.folderName === v.lecture)) {
        return badRequest('Unknown lecture');
      }
    }
  } else if (v.pageType === 'blog') {
    const allPosts = await getPublishedPosts();
    if (!allPosts.some((p) => p.slug === v.subject)) {
      return badRequest('Unknown blog post');
    }
  } else {
    return badRequest('Invalid pageType');
  }

  // Resolve parent (reply) — must be a published comment on the same page.
  let parentDepth = 0;
  if (v.parentId) {
    const resolved = await resolveParent(env.DB, v.parentId, {
      pageType: v.pageType,
      subject: v.subject,
      lecture: v.lecture,
    });
    if (!resolved) return badRequest('Cannot reply to that comment');
    parentDepth = resolved.depth;
  }

  // Moderate.
  const mod = moderateSubmission(v.displayName, v.body);
  if (mod.rejected) {
    // Profanity: reject, do not store. Keep generic message.
    return json({ error: 'Comment could not be posted. Please revise and try again.' }, 422);
  }

  // Author identity: signed-in users are tracked by id + a privacy-safe email
  // hash (so we can attribute/moderate without exposing the raw email). Anon
  // users keep the one-time delete token.
  const user = getUser(context);
  let authorUserId: string | null = null;
  let authorEmailHash: string | null = null;
  if (user && user.email) {
    authorUserId = user.id;
    const secret = (env as any).SESSION_SIGNING_KEY;
    if (!secret) return serverError('Server misconfigured');
    authorEmailHash = await sha256Hex(user.email.toLowerCase() + ':' + secret);
  }

  try {
    const { token, comment } = await createComment(env.DB, {
      pageType: v.pageType,
      subject: v.subject,
      lecture: v.lecture,
      displayName: v.displayName,
      body: v.body,
      status: mod.status,
      moderationReason: mod.reason,
      parentId: v.parentId,
      depth: parentDepth,
      authorUserId,
      authorEmailHash,
    });

    if (mod.status === 'pending') {
      return json({ success: true, id: comment.id, status: 'pending', token: null }, 202);
    }
    return json({ success: true, id: comment.id, status: 'published', token, parentId: comment.parentId }, 201);
  } catch (err: any) {
    return serverError('Failed to post comment');
  }
};
