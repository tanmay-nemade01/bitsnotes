/**
 * subjectVisibility.ts
 *
 * Subject Visibility & Admin Preview data-access layer.
 *
 * Provides functionality to hide a subject and all its lectures completely
 * from non-admin users. Admins can preview the hidden subject until they
 * make it public.
 *
 * Stored in Cloudflare D1 under the `subject_settings` table.
 * By default, any subject without a row in `subject_settings` is public (is_public = 1).
 */

import type { AuthDb } from './auth/db';
import { sha256Hex } from './auth/crypto';

export class SubjectVisibilityUnavailableError extends Error {}

export interface SubjectSettingRow {
  subject_name: string;
  is_public: number;
  updated_at: number;
  updated_by: string | null;
}

export interface SubjectSetting {
  subjectName: string;
  isPublic: boolean;
  updatedAt: number;
  updatedBy: string | null;
}

/**
 * Normalizes subject names for safe comparison.
 */
export function normalizeSubjectName(name: string): string {
  return name.trim();
}

let cachedHiddenSubjectNames: { data: Set<string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds memory cache per isolate

/**
 * Manually invalidates the subject visibility cache (e.g. after admin updates).
 */
export function invalidateSubjectVisibilityCache(): void {
  cachedHiddenSubjectNames = null;
}

/**
 * Returns a Set of canonical subject names that are hidden (is_public = 0).
 * Safe against missing DB or missing table.
 * Results are cached in worker memory for 60 seconds per isolate.
 */
export async function getHiddenSubjectNames(db?: AuthDb | null): Promise<Set<string>> {
  if (!db) {
    if (import.meta.env.DEV || (import.meta.env as any).MODE === 'test') {
      return new Set();
    }
    throw new SubjectVisibilityUnavailableError('Database connection unavailable for subject visibility check');
  }

  const now = Date.now();
  if (cachedHiddenSubjectNames && now < cachedHiddenSubjectNames.expiresAt) {
    return cachedHiddenSubjectNames.data;
  }

  try {
    const rows = await db
      .prepare('SELECT subject_name FROM subject_settings WHERE is_public = 0')
      .all<{ subject_name: string }>();

    const hiddenSet = new Set<string>();
    for (const row of rows.results ?? []) {
      if (row.subject_name) {
        hiddenSet.add(normalizeSubjectName(row.subject_name));
      }
    }
    cachedHiddenSubjectNames = { data: hiddenSet, expiresAt: now + CACHE_TTL_MS };
    return hiddenSet;
  } catch (err: any) {
    if (cachedHiddenSubjectNames) {
      return cachedHiddenSubjectNames.data;
    }
    throw new SubjectVisibilityUnavailableError(`Subject visibility unavailable: ${err?.message || 'query failed'}`);
  }
}

/**
 * Computes a 16-character hex fingerprint of the sorted hidden subjects set.
 */
export async function computeHiddenFingerprint(hiddenSubjects: Set<string> | string[]): Promise<string> {
  const sorted = [...hiddenSubjects].sort().join('|');
  const hash = await sha256Hex(sorted);
  return hash.slice(0, 16);
}

/**
 * Checks whether a given subject is public.
 * If db is absent or no record exists, defaults to true (public).
 */
export async function isSubjectPublic(
  db: AuthDb | null | undefined,
  subjectName: string,
): Promise<boolean> {
  if (!db || !subjectName) return true;

  const normalized = normalizeSubjectName(subjectName);
  try {
    const row = await db
      .prepare('SELECT is_public FROM subject_settings WHERE subject_name = ? COLLATE NOCASE')
      .bind(normalized)
      .first<{ is_public: number }>();

    if (!row) return true;
    return Number(row.is_public) === 1;
  } catch {
    return true;
  }
}

/**
 * Returns a map of subjectName -> isPublic boolean for all configured subjects.
 */
export async function listSubjectVisibilityMap(db?: AuthDb | null): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (!db) return map;

  try {
    const rows = await db
      .prepare('SELECT subject_name, is_public FROM subject_settings')
      .all<SubjectSettingRow>();

    for (const row of rows.results ?? []) {
      if (row.subject_name) {
        map.set(normalizeSubjectName(row.subject_name), Number(row.is_public) === 1);
      }
    }
  } catch {
    // Graceful fallback
  }

  return map;
}

/**
 * Sets the visibility of a subject (public vs hidden).
 * Requires admin authentication.
 */
export async function setSubjectVisibility(
  db: AuthDb,
  subjectName: string,
  isPublic: boolean,
  adminUserId?: string,
): Promise<{ subjectName: string; isPublic: boolean }> {
  const canonical = normalizeSubjectName(subjectName);
  if (!canonical) {
    throw new Error('Subject name cannot be empty.');
  }

  const publicVal = isPublic ? 1 : 0;
  const now = Date.now();
  const userId = adminUserId || null;

  await db
    .prepare(
      `INSERT INTO subject_settings (subject_name, is_public, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subject_name) DO UPDATE SET
         is_public = excluded.is_public,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(canonical, publicVal, now, userId)
    .run();

  invalidateSubjectVisibilityCache();

  return { subjectName: canonical, isPublic };
}
