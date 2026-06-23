/**
 * JWT session management.
 * Stateless signed JWT for access tokens, opaque refresh tokens stored in D1.
 */

import { hmacSign, hmacVerify, generateToken, sha256Hex, uuidv7 } from './crypto';
import type { AuthDb } from './db';

const ACCESS_TOKEN_TTL = 15 * 60;          // 15 minutes (seconds)
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionClaims {
  sub: string;       // user id
  email: string;
  tier: string;
  iat: number;       // issued at (epoch seconds)
  exp: number;       // expiry (epoch seconds)
  rt: string;        // refresh token id (jti — to link access → refresh)
}

interface JwtHeader {
  alg: string;
  typ: string;
}

// ─── JWT helpers ────────────────────────────────────────────────────────────

function base64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): unknown {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(atob(b64));
}

/**
 * Issue a signed JWT (HS256).
 */
export async function signJwt(
  claims: Omit<SessionClaims, 'iat' | 'exp'>,
  signingKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const payload: SessionClaims = {
    ...claims,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  };
  const body = `${base64url(header)}.${base64url(payload)}`;
  const sig = await hmacSign(signingKey, body);
  return `${body}.${sig}`;
}

/**
 * Verify a JWT and return claims, or null if invalid/expired.
 */
export async function verifyJwt(
  token: string,
  signingKey: string,
): Promise<SessionClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sig] = parts;

    const valid = await hmacVerify(signingKey, `${headerB64}.${payloadB64}`, sig);
    if (!valid) return null;

    const payload = base64urlDecode(payloadB64) as SessionClaims;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Refresh token management ───────────────────────────────────────────────

/**
 * Create a refresh token for a user. Returns the opaque token + hash.
 */
export async function createRefreshToken(
  db: AuthDb,
  userId: string,
): Promise<{ token: string; tokenHash: string }> {
  const token = generateToken(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();

  await db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(tokenHash, userId, now, now + REFRESH_TOKEN_TTL * 1000).run();

  return { token, tokenHash };
}

/**
 * Verify a refresh token. Returns user_id if valid, or null.
 * Handles rotation: revokes old token and creates a new one.
 */
export async function verifyRefreshToken(
  db: AuthDb,
  token: string,
): Promise<{ userId: string; newToken: string; newTokenHash: string } | null> {
  const tokenHash = await sha256Hex(token);
  const now = Date.now();

  const row = await db.prepare(
    'SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?',
  ).bind(tokenHash).first<{ user_id: string; expires_at: number; revoked_at: number | null }>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at < now) return null;

  // Rotate: revoke current, issue new
  await db.prepare(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?',
  ).bind(now, tokenHash).run();

  const newToken = generateToken(32);
  const newTokenHash = await sha256Hex(newToken);
  await db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(newTokenHash, row.user_id, now, now + REFRESH_TOKEN_TTL * 1000).run();

  return { userId: row.user_id, newToken, newTokenHash };
}

/**
 * Revoke all refresh tokens for a user (used on logout).
 */
export async function revokeAllRefreshTokens(db: AuthDb, userId: string): Promise<void> {
  await db.prepare(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
  ).bind(Date.now(), userId).run();
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────

const SESSION_COOKIE = '__session';
const REFRESH_COOKIE = '__rt';

export function setSessionCookie(headers: Headers, token: string): void {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ACCESS_TOKEN_TTL}`,
  );
}

export function setRefreshCookie(headers: Headers, token: string): void {
  headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE}=${token}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=${REFRESH_TOKEN_TTL}`,
  );
}

export function clearSessionCookie(headers: Headers): void {
  headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function clearRefreshCookie(headers: Headers): void {
  headers.append('Set-Cookie', `${REFRESH_COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export function getRefreshTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${REFRESH_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

// ─── OAuth state cookie ─────────────────────────────────────────────────────

const STATE_COOKIE = '__oauth_state';
const STATE_TTL = 10 * 60; // 10 minutes

export function setOAuthStateCookie(headers: Headers, state: string): void {
  headers.append(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/api/auth/callback; HttpOnly; Secure; SameSite=Strict; Max-Age=${STATE_TTL}`,
  );
}

export function getOAuthStateFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${STATE_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export function clearOAuthStateCookie(headers: Headers): void {
  headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth/callback; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
