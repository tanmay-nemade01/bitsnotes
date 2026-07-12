import { describe, it, expect } from 'vitest';
import {
  generateVisitorId,
  visitorCookieHeader,
  getVisitorId,
  hashVisitor,
} from '../src/lib/visitor';

function reqWithCookie(cookie: string): Request {
  return new Request('https://bitsnotes.com/x', { headers: { Cookie: cookie } });
}

describe('visitor cookie', () => {
  it('generates an opaque hex id', () => {
    const id = generateVisitorId();
    expect(id).toMatch(/^[0-9a-f]{48}$/);
  });

  it('builds a Set-Cookie with SameSite=Lax and Secure', () => {
    const header = visitorCookieHeader('abc123');
    expect(header).toContain('bitsnotes-visitor=abc123');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Path=/');
  });

  it('reads the visitor id from a Cookie header', () => {
    const id = getVisitorId(reqWithCookie('foo=1; bitsnotes-visitor=myid; bar=2'));
    expect(id).toBe('myid');
  });

  it('returns null when cookie absent', () => {
    expect(getVisitorId(reqWithCookie('foo=1'))).toBeNull();
  });

  it('returns null for empty id value', () => {
    expect(getVisitorId(reqWithCookie('bitsnotes-visitor='))).toBeNull();
  });
});

describe('hashVisitor', () => {
  it('is deterministic for the same id+secret', async () => {
    const a = await hashVisitor('id1', 'secret');
    const b = await hashVisitor('id1', 'secret');
    expect(a).toBe(b);
  });

  it('differs for different ids', async () => {
    expect(await hashVisitor('id1', 'secret')).not.toBe(await hashVisitor('id2', 'secret'));
  });

  it('differs for different secrets', async () => {
    expect(await hashVisitor('id1', 's1')).not.toBe(await hashVisitor('id1', 's2'));
  });
});
