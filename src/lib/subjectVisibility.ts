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

/**
 * Returns a Set of canonical subject names that are hidden (is_public = 0).
 * Safe against missing DB or missing table (returns empty Set on failure).
 */
export async function getHiddenSubjectNames(db?: AuthDb | null): Promise<Set<string>> {
  if (!db) return new Set();

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
    return hiddenSet;
  } catch (err: any) {
    // Graceful fallback if table doesn't exist yet in older isolates or migrations
    return new Set();
  }
}

/**
 * Checks whether a given subject is public.
 * If db is absent or no record exists, defaults to true (public).
 */
export async function isSubjectPublic(
  db: AuthDb | null | undefined,
  subjectName: string
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
  adminUserId?: string
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
         updated_by = excluded.updated_by`
    )
    .bind(canonical, publicVal, now, userId)
    .run();

  return { subjectName: canonical, isPublic };
}
