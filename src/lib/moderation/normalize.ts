/**
 * Text normalization for moderation.
 * Produces a canonical form used by the profanity + spam checks so that
 * obfuscation (leet-speak, zero-width chars, repeated chars) is defeated.
 */

/** Strip zero-width / invisible characters. */
const ZERO_WIDTH = /[​-‍﻿⁠]/g;

/** Common leet-speak substitutions. */
const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g',
  '°': 'o', '©': 'c', '(': 'c', '<': 'c',
};

/**
 * Normalize a string for matching:
 *  - NFKC normalization (folds fullwidth, compatibility chars)
 *  - lowercase
 *  - strip zero-width / invisible chars
 *  - decode simple leet-speak
 *  - collapse 3+ repeated letters to a single letter
 *  - collapse whitespace
 */
export function normalizeForMatch(input: string): string {
  let s = input.normalize('NFKC').toLowerCase();
  s = s.replace(ZERO_WIDTH, '');

  // Decode leet-speak (only when surrounded by word-ish context).
  s = s.replace(/[01345789!|@$°©(<>]/g, (ch) => LEET_MAP[ch] ?? ch);

  // Collapse repeated characters (e.g. "fuuuuck" -> "fuck").
  s = s.replace(/(.)\1{2,}/g, '$1');

  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/** Count links in a raw string (http(s), www, bare domains). */
export function countLinks(input: string): number {
  const linkRe = /(https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(com|net|org|io|co|info|ru|cn|tk|ml|ga)(?:\b|\/)/gi;
  const matches = input.match(linkRe);
  return matches ? matches.length : 0;
}
