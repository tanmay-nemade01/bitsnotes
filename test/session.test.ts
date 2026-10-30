import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  createRefreshToken,
  verifyRefreshToken,
  isAccessTokenRevoked,
  getSessionTokenFromCookie,
  getRefreshTokenFromCookie,
  getOAuthStateFromCookie,
} from '../src/lib/auth/session';
import { createUser } from '../src/lib/auth/db';

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
});

describe('Refresh-token reuse detection (Task 7.3)', () => {
  it('detects stolen token reuse beyond 60s grace window and revokes all tokens for user', async () => {
    const user = await createUser(db, {
      email: 'victim@example.com',
      displayName: 'Victim',
    });

    // 1. Initial refresh token
    const initial = await createRefreshToken(db, user.id);

    // 2. Legitimate rotation
    const rotated = await verifyRefreshToken(db, initial.token);
    expect(rotated).not.toBeNull();
    const successorToken = rotated!.newToken;

    // 3. Stolen token used within 60s grace window -> returns null, but does not revoke successor
    const reuseWithinGrace = await verifyRefreshToken(db, initial.token);
    expect(reuseWithinGrace).toBeNull();

    // Successor is still valid
    const successorCheck = await verifyRefreshToken(db, successorToken);
    expect(successorCheck).not.toBeNull();
    const activeToken = successorCheck!.newToken;

    // 4. Manipulate revoked_at of the old token to be 61 seconds in the past (> 60_000 ms)
    const oldRevokedAt = Date.now() - 65_000;
    await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?')
      .bind(oldRevokedAt, initial.tokenHash)
      .run();

    // 5. Stolen token reused after grace period expires -> triggers reuse detection & revokes all tokens
    const reuseAfterGrace = await verifyRefreshToken(db, initial.token);
    expect(reuseAfterGrace).toBeNull();

    // 6. Verify that the user's active token is now revoked as a security measure
    const activeCheck = await verifyRefreshToken(db, activeToken);
    expect(activeCheck).toBeNull();
  });
});

describe('Cookie regex boundary anchoring (Task 7.4)', () => {
  it('anchors getSessionTokenFromCookie so x__session does not match', () => {
    expect(getSessionTokenFromCookie('x__session=malicious')).toBeNull();
    expect(getSessionTokenFromCookie('foo=bar; x__session=malicious')).toBeNull();
    expect(getSessionTokenFromCookie('x__session=malicious; __session=valid-session')).toBe('valid-session');
    expect(getSessionTokenFromCookie('__session=valid-session; other=123')).toBe('valid-session');
  });

  it('anchors getRefreshTokenFromCookie so x__rt does not match', () => {
    expect(getRefreshTokenFromCookie('x__rt=malicious')).toBeNull();
    expect(getRefreshTokenFromCookie('foo=bar; x__rt=malicious')).toBeNull();
    expect(getRefreshTokenFromCookie('x__rt=malicious; __rt=valid-rt')).toBe('valid-rt');
    expect(getRefreshTokenFromCookie('__rt=valid-rt; other=123')).toBe('valid-rt');
  });

  it('anchors getOAuthStateFromCookie so x__oauth_state does not match', () => {
    expect(getOAuthStateFromCookie('x__oauth_state=malicious')).toBeNull();
    expect(getOAuthStateFromCookie('foo=bar; x__oauth_state=malicious')).toBeNull();
    expect(getOAuthStateFromCookie('x__oauth_state=malicious; __oauth_state=valid-state')).toBe('valid-state');
    expect(getOAuthStateFromCookie('__oauth_state=valid-state; other=123')).toBe('valid-state');
  });
});

describe('Access token revocation helper isAccessTokenRevoked (Task 7.2)', () => {
  it('returns true for missing token hash', async () => {
    expect(await isAccessTokenRevoked(db, '')).toBe(true);
    expect(await isAccessTokenRevoked(db, 'non-existent-hash')).toBe(true);
  });

  it('returns false for active refresh token', async () => {
    const user = await createUser(db, { email: 'a@example.com', displayName: 'A' });
    const { tokenHash } = await createRefreshToken(db, user.id);
    expect(await isAccessTokenRevoked(db, tokenHash)).toBe(false);
  });

  it('returns false for rotated token where replaced_by is set', async () => {
    const user = await createUser(db, { email: 'b@example.com', displayName: 'B' });
    const { token, tokenHash } = await createRefreshToken(db, user.id);
    await verifyRefreshToken(db, token); // rotates token: sets revoked_at and replaced_by
    expect(await isAccessTokenRevoked(db, tokenHash)).toBe(false);
  });

  it('returns true for logged out / deleted token where revoked_at is set but replaced_by is null', async () => {
    const user = await createUser(db, { email: 'c@example.com', displayName: 'C' });
    const { tokenHash } = await createRefreshToken(db, user.id);
    await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), tokenHash)
      .run();
    expect(await isAccessTokenRevoked(db, tokenHash)).toBe(true);
  });
});

