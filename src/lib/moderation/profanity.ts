/**
 * Profanity detection (server-side).
 *
 * Uses the `obscenity` package with the English preset. We normalize the
 * input first (NFKC, leet-speak, zero-width, repeat-collapse) so obfuscated
 * variants are caught. Academic allowlist terms are exempted.
 */

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';
import { normalizeForMatch } from './normalize';
import { isAllowlistedOnly } from './terms';

// Build the matcher once (module-level singleton).
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export interface ProfanityResult {
  /** True if explicit profanity/slurs were detected. */
  hasProfanity: boolean;
  /** Number of distinct matches. */
  matchCount: number;
}

/**
 * Check whether the given text contains profanity.
 * Only filters user submissions — never lecture content.
 */
export function checkProfanity(rawText: string): ProfanityResult {
  const normalized = normalizeForMatch(rawText);

  if (isAllowlistedOnly(normalized)) {
    return { hasProfanity: false, matchCount: 0 };
  }

  const matches = matcher.getAllMatches(normalized);
  return {
    hasProfanity: matches.length > 0,
    matchCount: matches.length,
  };
}
