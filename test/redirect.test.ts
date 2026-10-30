import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '../src/lib/auth/redirect';

const BASE = 'https://bitsnotes.com';

describe('Task 3 — safeRedirectPath open redirect protection', () => {
  const cases: Array<[raw: unknown, expected: string | null]> = [
    ['/view/a/b?x=1#t', '/view/a/b?x=1#t'],
    ['https://www.bitsnotes.com/account', '/account'],
    ['https://bitsnotes.com//evil.com', null],
    ['/.//evil.com', null],
    ['//evil.com', null],
    ['/\\evil.com', null],
    ['https://evil.com/x', null],
    ['javascript:alert(1)', null],
    ['/ok\nSet-Cookie: x', null],
    [123, null],
    ['', null],
    [undefined, null],
  ];

  for (const [raw, expected] of cases) {
    it(`correctly evaluates safeRedirectPath(${JSON.stringify(raw)}) -> ${JSON.stringify(expected)}`, () => {
      expect(safeRedirectPath(raw, BASE)).toBe(expected);
    });
  }
});

