import { describe, it, expect } from 'vitest';
import { normalizeForMatch, countLinks } from '../src/lib/moderation/normalize';
import { checkProfanity } from '../src/lib/moderation/profanity';
import { checkSpam } from '../src/lib/moderation/spam';
import { isAllowlistedOnly } from '../src/lib/moderation/terms';

describe('normalizeForMatch', () => {
  it('lowercases and trims', () => {
    expect(normalizeForMatch('  HeLLo  ')).toBe('hello');
  });

  it('strips zero-width characters', () => {
    const withZW = 'he\u200bllo';
    expect(normalizeForMatch(withZW)).toBe('hello');
  });

  it('decodes leet-speak', () => {
    expect(normalizeForMatch('h3ll0')).toBe('hello');
  });

  it('collapses repeated characters (fuck -> fuuuck)', () => {
    expect(normalizeForMatch('fuuuuck')).toBe('fuck');
  });

  it('collapses whitespace', () => {
    expect(normalizeForMatch('a   b\n\tc')).toBe('a b c');
  });

  it('applies NFKC normalization', () => {
    // Fullwidth characters fold to ASCII.
    expect(normalizeForMatch('ｈｅｌｌｏ')).toBe('hello');
  });
});

describe('countLinks', () => {
  it('counts http(s) links', () => {
    expect(countLinks('see https://example.com and http://a.b')).toBe(2);
  });

  it('counts bare domains', () => {
    expect(countLinks('visit example.com now')).toBe(1);
  });

  it('returns 0 when none', () => {
    expect(countLinks('just text')).toBe(0);
  });
});

describe('checkProfanity', () => {
  it('flags explicit profanity', () => {
    const r = checkProfanity('you are an ass');
    expect(r.hasProfanity).toBe(true);
    expect(r.matchCount).toBeGreaterThan(0);
  });

  it('flags obfuscated profanity (leet + repeat)', () => {
    expect(checkProfanity('what the fffffuuck').hasProfanity).toBe(true);
  });

  it('flags zero-width-obfuscated profanity', () => {
    // 'fuck' is in the dataset; insert a zero-width char to obfuscate.
    expect(checkProfanity('f​uck').hasProfanity).toBe(true);
  });

  it('rejects clean text', () => {
    expect(checkProfanity('great explanation, thanks!').hasProfanity).toBe(false);
  });

  it('exempts academic allowlist-only text', () => {
    // "hell" is in the academic allowlist (e.g. "shell", "hello").
    expect(checkProfanity('what the hell').hasProfanity).toBe(false);
  });

  it('does NOT exempt a real profanity even if an allowlisted word is present', () => {
    expect(checkProfanity('this class is shit').hasProfanity).toBe(true);
  });
});

describe('isAllowlistedOnly', () => {
  it('returns true when all tokens are allowlisted', () => {
    expect(isAllowlistedOnly('hell')).toBe(true);
  });

  it('returns false when a non-allowlisted token is present', () => {
    expect(isAllowlistedOnly('analysis hello')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isAllowlistedOnly('')).toBe(false);
  });
});

describe('checkSpam', () => {
  it('flags too many links', () => {
    const r = checkSpam('name', 'buy now https://a.com and https://b.com and https://c.com');
    expect(r.isSpam).toBe(true);
    expect(r.reasons).toContain('too_many_links:3');
  });

  it('flags repeat filler', () => {
    const r = checkSpam('name', 'buy now aaaaaaaaaaaaaaaaaaaaa');
    expect(r.reasons).toContain('repeat_filler');
  });

  it('flags low lexical diversity on long body', () => {
    // 100 chars of only two distinct letters -> ratio 0.02 < 0.25, and no
    // 20+ repeat run (alternating), so only low_diversity fires.
    const body = 'ab'.repeat(50);
    const r = checkSpam('name', body);
    expect(r.reasons).toContain('low_diversity');
    expect(r.reasons).not.toContain('repeat_filler');
  });

  it('flags promo name', () => {
    const r = checkSpam('buy@cheap.com', 'hello');
    expect(r.reasons).toContain('promo_name');
  });

  it('passes a normal comment', () => {
    const r = checkSpam('Ada', 'This derivation of the Bellman equation really helped me, thank you!');
    expect(r.isSpam).toBe(false);
  });
});
