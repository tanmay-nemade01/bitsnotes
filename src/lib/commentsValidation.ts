/**
 * Shared validation for comment submission (Phase 4).
 * Pure functions so they can be unit-tested without a request context.
 */

import { sanitizeString } from './apiHelpers';
import { checkProfanity } from './moderation/profanity';
import { checkSpam } from './moderation/spam';
import { countLinks } from './moderation/normalize';

export const MAX_BODY = 1500;
export const MIN_BODY = 3;
export const MAX_NAME = 40;
export const MIN_NAME = 2;
export const MIN_FILL_MS = 2000;
export const MAX_JSON_BYTES = 16 * 1024; // 16KB cap before parse

export type ValidationOutcome =
  | { ok: true; pageType: 'lecture' | 'subject'; subject: string; lecture: string | null; displayName: string; body: string; parentId: string | null }
  | { ok: false; error: string; status: number };

/**
 * Validate the raw parsed body of a comment POST.
 * Does NOT check CSRF / rate-limit / Turnstile — those are request-layer.
 */
export function validateCommentBody(body: Record<string, unknown>): ValidationOutcome {
  const pageType = body.pageType;
  if (pageType !== 'lecture' && pageType !== 'subject') {
    return { ok: false, error: 'Invalid pageType', status: 400 };
  }

  const subject = sanitizeString(body.subject, 200);
  if (!subject) return { ok: false, error: 'Subject is required', status: 400 };

  // Lecture required for lecture pages.
  let lecture: string | null = null;
  if (pageType === 'lecture') {
    lecture = sanitizeString(body.lecture, 200);
    if (!lecture) return { ok: false, error: 'Lecture is required', status: 400 };
  }

  // Optional parent (reply). Must be a non-empty string id if present.
  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    if (typeof body.parentId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.parentId)) {
      return { ok: false, error: 'Invalid parent comment', status: 400 };
    }
    parentId = body.parentId;
  }

  // Reject over-length input before sanitizing (do not silently truncate).
  const rawDisplayName = typeof body.displayName === 'string' ? body.displayName : '';
  if (rawDisplayName.length > MAX_NAME) {
    return { ok: false, error: `Display name must be at most ${MAX_NAME} characters`, status: 400 };
  }
  const displayName = sanitizeString(rawDisplayName, MAX_NAME);
  if (!displayName) return { ok: false, error: 'Display name is required', status: 400 };
  if (displayName.length < MIN_NAME) {
    return { ok: false, error: 'Display name must be at least 2 characters', status: 400 };
  }

  const rawBody = typeof body.body === 'string' ? body.body : '';
  if (rawBody.length > MAX_BODY) {
    return { ok: false, error: `Comment must be at most ${MAX_BODY} characters`, status: 400 };
  }
  const cleanBody = sanitizeString(rawBody, MAX_BODY);
  if (!cleanBody) return { ok: false, error: 'Comment body is required', status: 400 };
  if (cleanBody.length < MIN_BODY) {
    return { ok: false, error: 'Comment must be at least 3 characters', status: 400 };
  }

  // Reject HTML tags.
  if (/<[a-z!/][\s\S]*>/i.test(rawBody)) {
    return { ok: false, error: 'HTML is not allowed', status: 400 };
  }

  // At most one link.
  if (countLinks(rawBody) > 1) {
    return { ok: false, error: 'At most one link is allowed', status: 400 };
  }

  return {
    ok: true,
    pageType,
    subject,
    lecture,
    displayName,
    body: cleanBody,
    parentId,
  };
}

/**
 * Decide the moderation outcome for a validated submission.
 *  - profanity => reject (do not store)
 *  - spam => pending
 *  - otherwise => published
 */
export function moderateSubmission(displayName: string, body: string): {
  status: 'published' | 'pending';
  reason: string | null;
  rejected: boolean;
} {
  const prof = checkProfanity(body + ' ' + displayName);
  if (prof.hasProfanity) {
    return { status: 'pending', reason: null, rejected: true };
  }
  const spam = checkSpam(displayName, body);
  if (spam.isSpam) {
    return { status: 'pending', reason: 'held for review: ' + spam.reasons.join(','), rejected: false };
  }
  return { status: 'published', reason: null, rejected: false };
}
