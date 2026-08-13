/**
 * D1 database wrappers for auth queries.
 * All queries use parameterized prepared statements — no string concatenation.
 */

import type { D1PreparedStatement, D1ExecResult } from '@cloudflare/workers-types';
import { uuidv7 } from './crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  email_verified_at: number | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
  status: string;
}

export interface AuthIdentity {
  id: string;
  user_id: string;
  provider: string;
  provider_uid: string;
  created_at: number;
}

export interface AuthEntitlement {
  user_id: string;
  tier: string;
  expires_at: number | null;
  source: string;
  updated_at: number;
}

// Thin wrapper so we can bind `.bind(...)` ergonomically
export interface AuthDb {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
}

// ─── User CRUD ──────────────────────────────────────────────────────────────

/**
 * Find a user by email.
 */
export async function findUserByEmail(db: AuthDb, email: string): Promise<AuthUser | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim())
    .first<AuthUser>();
}

/**
 * Find a user by id.
 */
export async function findUserById(db: AuthDb, id: string): Promise<AuthUser | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<AuthUser>();
}

/**
 * Create a new pending user. Returns the created user.
 */
export async function createUser(db: AuthDb, opts: {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}): Promise<AuthUser> {
  const id = uuidv7();
  const now = Date.now();
  const email = opts.email.toLowerCase().trim();
  // Strip control chars from display name (max 80 chars)
  const displayName = opts.displayName
    ? opts.displayName.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80)
    : null;

  await db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).bind(id, email, displayName, opts.avatarUrl, now, now).run();

  // Auto-create entitlement row
  await db.prepare(
    `INSERT INTO entitlements (user_id, tier, source, updated_at) VALUES (?, 'free', 'manual', ?)`,
  ).bind(id, now).run();

  return { id, email, email_verified_at: null, display_name: displayName, avatar_url: opts.avatarUrl, created_at: now, updated_at: now, status: 'pending' };
}

/**
 * Verify user email (activate account).
 */
export async function verifyUserEmail(db: AuthDb, userId: string): Promise<void> {
  const now = Date.now();
  await db.prepare(
    'UPDATE users SET email_verified_at = ?, status = ?, updated_at = ? WHERE id = ?',
  ).bind(now, 'active', now, userId).run();
}

/**
 * Soft-delete a user account (GDPR erasure).
 * Anonymizes PII, revokes sessions, removes owned data, keeps public comment text.
 */
export async function deleteUserAccount(db: AuthDb, userId: string): Promise<void> {
  const now = Date.now();
  const tombstoneEmail = `deleted-${userId}@deleted.local`;

  // Anonymize authored comments (keep public body; drop identity linkage).
  await db.prepare(
    `UPDATE comments SET author_user_id = NULL, author_email_hash = NULL, updated_at = ? WHERE author_user_id = ?`,
  ).bind(now, userId).run();

  // Revoke sessions
  await db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  ).bind(now, userId).run();

  // Delete owned rows (FKs cascade for some; explicit for clarity)
  await db.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM collections WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM reading_progress WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM topic_progress WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM blog_likes WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM blog_follows WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM bit_reactions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM admin_users WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM identities WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM verification_tokens WHERE user_id = ?').bind(userId).run();

  // Soft-delete user row (unique email freed via tombstone)
  await db.prepare(
    `UPDATE users SET email = ?, display_name = NULL, avatar_url = NULL, status = 'deleted', updated_at = ? WHERE id = ?`,
  ).bind(tombstoneEmail, now, userId).run();
}

/**
 * Get entitlement for a user.
 */
export async function getEntitlement(db: AuthDb, userId: string): Promise<AuthEntitlement | null> {
  return db.prepare('SELECT * FROM entitlements WHERE user_id = ?')
    .bind(userId).first<AuthEntitlement>();
}

// ─── Identity CRUD ──────────────────────────────────────────────────────────

/**
 * Find identity by provider + provider_uid.
 */
export async function findIdentity(db: AuthDb, provider: string, providerUid: string): Promise<AuthIdentity | null> {
  return db.prepare(
    'SELECT * FROM identities WHERE provider = ? AND provider_uid = ?',
  ).bind(provider, providerUid).first<AuthIdentity>();
}

/**
 * Create an identity link.
 */
export async function createIdentity(db: AuthDb, userId: string, provider: string, providerUid: string): Promise<AuthIdentity> {
  const id = uuidv7();
  const now = Date.now();
  await db.prepare(
    'INSERT INTO identities (id, user_id, provider, provider_uid, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, userId, provider, providerUid, now).run();
  return { id, user_id: userId, provider, provider_uid: providerUid, created_at: now };
}

// ─── Verification tokens ────────────────────────────────────────────────────

/**
 * Store a verification token (hashed).
 */
export async function storeVerificationToken(
  db: AuthDb,
  userId: string,
  tokenHash: string,
  purpose: string,
  expiresAt: number,
): Promise<void> {
  await db.prepare(
    'INSERT INTO verification_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(tokenHash, userId, purpose, expiresAt, Date.now()).run();
}

/**
 * Consume a verification token (single-use). Returns userId if valid.
 */
export async function consumeVerificationToken(
  db: AuthDb,
  tokenHash: string,
  purpose: string,
): Promise<{ userId: string } | null> {
  const now = Date.now();
  const row = await db.prepare(
    'SELECT user_id, expires_at, consumed_at FROM verification_tokens WHERE token_hash = ? AND purpose = ?',
  ).bind(tokenHash, purpose).first<{ user_id: string; expires_at: number; consumed_at: number | null }>();

  if (!row) return null;
  if (row.consumed_at) return null; // already used
  if (row.expires_at < now) return null; // expired

  await db.prepare(
    'UPDATE verification_tokens SET consumed_at = ? WHERE token_hash = ?',
  ).bind(now, tokenHash).run();

  return { userId: row.user_id };
}
