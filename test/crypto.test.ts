import { describe, it, expect } from 'vitest';
import { sha256Hex, hmacSign, hmacVerify, uuidv7, generateToken } from '../src/lib/auth/crypto';

describe('sha256Hex', () => {
  it('produces a stable 64-char hex digest', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('hmacSign / hmacVerify', () => {
  it('verifies a valid signature', async () => {
    const sig = await hmacSign('secret', 'visitor:abc');
    expect(await hmacVerify('secret', 'visitor:abc', sig)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const sig = await hmacSign('secret', 'visitor:abc');
    expect(await hmacVerify('secret', 'visitor:xyz', sig)).toBe(false);
  });

  it('rejects with wrong secret', async () => {
    const sig = await hmacSign('secret', 'visitor:abc');
    expect(await hmacVerify('other', 'visitor:abc', sig)).toBe(false);
  });
});

describe('uuidv7', () => {
  it('returns a v7 UUID string', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces unique values', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(set.size).toBe(1000);
  });

  it('is time-ordered within the same millisecond', () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});

describe('generateToken', () => {
  it('produces a url-safe token of expected length', () => {
    const t = generateToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> 43 base64url chars (no padding).
    expect(t.length).toBe(43);
  });
});
