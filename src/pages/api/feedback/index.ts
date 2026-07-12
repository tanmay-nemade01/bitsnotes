/**
 * Page Feedback API (Phase 5).
 *
 * GET  /api/feedback?pageType=&subject=&lecture=
 *      → { useful, notYet, myVote } (myVote resolved from visitor cookie hash)
 *
 * POST /api/feedback
 *      body: pageType, subject, lecture, value (1|-1), optional reason
 *      → { ok, value } ; issues/refreshes the functional visitor cookie
 *
 * No login. Same-origin + rate-limited (FEEDBACK_RATE_LIMITER) + cookie-based
 * dedupe. Reason is stored but never returned by GET in v1.
 */

import type { APIRoute } from 'astro';
import { getEnv, json, badRequest, tooMany, serverError } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { getClientIp } from '../../../lib/apiHelpers';
import { getFeedbackAggregate, upsertFeedback } from '../../../lib/feedback';
import { sanitizeString } from '../../../lib/apiHelpers';
import { checkProfanity } from '../../../lib/moderation/profanity';
import { checkSpam } from '../../../lib/moderation/spam';
import { countLinks } from '../../../lib/moderation/normalize';
import { listLectures, listSubjects } from '../../../utils/notesLoader';
import {
  generateVisitorId,
  getVisitorId,
  visitorCookieHeader,
  hashVisitor,
} from '../../../lib/visitor';

export const prerender = false;

const MAX_JSON_BYTES = 4 * 1024; // 4KB cap before parse
const MAX_REASON = 300;
const COOKIE_SECRET_FALLBACK = 'bitsnotes-feedback-v1';

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);
  const url = new URL(context.request.url);
  const pageType = url.searchParams.get('pageType');
  const subject = url.searchParams.get('subject');
  const lecture = url.searchParams.get('lecture');

  if (pageType !== 'lecture' && pageType !== 'subject') {
    return badRequest('pageType must be "lecture" or "subject"');
  }
  if (!subject) return badRequest('subject is required');
  if (pageType === 'lecture' && !lecture) {
    return badRequest('lecture is required for lecture pages');
  }

  try {
    const visitorId = getVisitorId(context.request);
    const secret = (env as any).SESSION_SIGNING_KEY || COOKIE_SECRET_FALLBACK;
    const visitorHash = visitorId ? await hashVisitor(visitorId, secret) : null;

    const agg = await getFeedbackAggregate(env.DB, {
      pageType,
      subject,
      lecture: pageType === 'lecture' ? lecture : null,
      visitorHash,
    });
    return json(agg, 200, { 'Cache-Control': 'no-store' });
  } catch {
    // Return defaults on any DB error (e.g., table doesn't exist yet)
    return json({ useful: 0, notYet: 0, myVote: null }, 200);
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

  const pageType = body.pageType;
  if (pageType !== 'lecture' && pageType !== 'subject') {
    return badRequest('Invalid pageType');
  }
  const subject = sanitizeString(body.subject, 200);
  if (!subject) return badRequest('Subject is required');

  let lecture: string | null = null;
  if (pageType === 'lecture') {
    lecture = sanitizeString(body.lecture, 200);
    if (!lecture) return badRequest('Lecture is required');
  }

  const rawValue = body.value;
  if (rawValue !== 1 && rawValue !== -1 && rawValue !== '1' && rawValue !== '-1') {
    return badRequest('value must be 1 (useful) or -1 (not yet)');
  }
  const value: 1 | -1 = rawValue === 1 || rawValue === '1' ? 1 : -1;

  // Optional reason (moderated like comments, NOT public in v1).
  let reason: string | null = null;
  if (typeof body.reason === 'string' && body.reason.trim() !== '') {
    const clean = sanitizeString(body.reason, MAX_REASON);
    if (!clean) {
      return badRequest('Reason is too long or invalid');
    }
    if (clean.length < 2) {
      return badRequest('Reason is too short');
    }
    if (/<[a-z!/][\s\S]*>/i.test(body.reason)) {
      return badRequest('HTML is not allowed');
    }
    if (countLinks(body.reason) > 1) {
      return badRequest('At most one link is allowed');
    }
    const prof = checkProfanity(clean);
    if (prof.hasProfanity) {
      return badRequest('Reason could not be saved. Please revise and try again.');
    }
    const spam = checkSpam('visitor', clean);
    if (spam.isSpam) {
      // Hold the reason (don't store) but still record the vote.
      reason = null;
    } else {
      reason = clean;
    }
  }

  // Verify subject/lecture exist in manifest.
  const subjects = await listSubjects();
  if (!subjects.some((s) => s.name === subject)) {
    return badRequest('Unknown subject');
  }
  if (pageType === 'lecture') {
    const lectures = await listLectures(subject);
    if (!lectures.some((l) => l.folderName === lecture)) {
      return badRequest('Unknown lecture');
    }
  }

  // Rate limit (Cloudflare Rate Limit binding).
  if (env.FEEDBACK_RATE_LIMITER) {
    const ip = getClientIp(context.request);
    const { success } = await env.FEEDBACK_RATE_LIMITER.limit({ key: `f:${ip}` });
    if (!success) return tooMany('Too many requests. Please try again later.');
  }

  // Resolve / issue the functional visitor cookie.
  const secret = (env as any).SESSION_SIGNING_KEY || COOKIE_SECRET_FALLBACK;
  let visitorId = getVisitorId(context.request);
  let setCookie: string | null = null;
  if (!visitorId) {
    visitorId = generateVisitorId();
    setCookie = visitorCookieHeader(visitorId);
  }
  const visitorHash = await hashVisitor(visitorId!, secret);

  try {
    const stored = await upsertFeedback(env.DB, {
      pageType,
      subject,
      lecture: pageType === 'lecture' ? lecture : null,
      visitorHash,
      value,
      reason,
    });

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (setCookie) headers['Set-Cookie'] = setCookie;

    return json({ ok: true, value: stored }, 200, headers);
  } catch {
    return serverError('Failed to save feedback');
  }
};
