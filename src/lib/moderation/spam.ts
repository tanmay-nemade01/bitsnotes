/**
 * Spam / abuse heuristics (server-side).
 *
 * Returns a verdict used to decide whether a submission should be stored as
 * `pending` (for human review) rather than `published`.
 */

import { normalizeForMatch, countLinks } from './normalize';

export interface SpamResult {
  /** True if the submission looks like spam and should be held for review. */
  isSpam: boolean;
  reasons: string[];
}

const MAX_LINKS = 1;            // Plan: at most one link allowed in published comments

const MIN_DISTINCT_RATIO = 0.25;  // very low lexical diversity => likely spam

export function checkSpam(rawName: string, rawBody: string): SpamResult {
  const reasons: string[] = [];
  const body = rawBody ?? '';
  const normalizedBody = normalizeForMatch(body);

  // Link count
  const links = countLinks(body);
  if (links > MAX_LINKS) {
    reasons.push(`too_many_links:${links}`);
  }

  // Repeated-character filler (e.g. "buy now aaaaaaaaaaaaaaaaaaaaa")
  const repeatRuns = body.match(/(.)\1{19,}/g);
  if (repeatRuns) {
    reasons.push('repeat_filler');
  }

  // Low lexical diversity over a long body
  if (body.length >= 80) {
    const distinct = new Set(normalizedBody.replace(/[^a-z0-9]/g, '').split('')).size;
    const ratio = distinct / Math.max(1, normalizedBody.replace(/[^a-z0-9]/g, '').length);
    if (ratio < MIN_DISTINCT_RATIO) {
      reasons.push('low_diversity');
    }
  }

  // Name looks like a URL / promo
  if (/https?:\/\/|www\.|\.(com|net|org|io)\b/i.test(rawName ?? '')) {
    reasons.push('promo_name');
  }

  return {
    isSpam: reasons.length > 0,
    reasons,
  };
}
