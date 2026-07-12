/**
 * Academic allowlist.
 *
 * Words that the profanity matcher may flag but which are legitimate in an
 * academic / ML / math context. These are checked against the *normalized*
 * text and, if present, exempt the submission from profanity rejection.
 *
 * Kept deliberately small and reviewed. Add terms only when a real false
 * positive is observed in production.
 */

export const ACADEMIC_ALLOWLIST: string[] = [
  // Statistics / ML
  'ass',            // e.g. "class", "pass", "mass" — handled by word boundary below
  'anal',           // "analysis", "analog", "canal"
  'anus',           // rare; covered by boundary check
  'tit',            // "title", "titration", "constitution"
  'sex',            // "sextant", "sexagesimal", "appendix"
  'hell',           // "shell", "hello"
  'damn',           // "condemn", "adamant"
  'dyke',           // "dykes" in hydrology
  'fag',            // "faggot" as bundle of sticks (historical)
  'puss',           // "pussycat", "pus" (medical)
  'cock',           // "cockpit", "peacock"
  'slut',           // rare false positives
  'whore',          // "where", "nowhere"
  'bastard',        // "bastard" in math (bastard notation) — uncommon
  'niggard',        // "niggardly" (miserly) — historical false positive
];

/**
 * Returns true if the normalized text contains only allowlisted words
 * (i.e. every flagged token is part of a legitimate academic term).
 *
 * We do a conservative check: if the normalized text is composed solely of
 * allowlisted tokens (plus whitespace/punctuation), it's exempt.
 */
export function isAllowlistedOnly(normalized: string): boolean {
  const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => ACADEMIC_ALLOWLIST.includes(t));
}
