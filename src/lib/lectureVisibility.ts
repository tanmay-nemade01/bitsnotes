/**
 * lectureVisibility.ts
 *
 * Lecture Visibility & Admin Preview data-access layer.
 *
 * Complements subjectVisibility.ts: a subject can be public while some of its
 * lectures are hidden. Hidden lectures are completely invisible to non-admin
 * users (listings, search, sitemap, bookmarks and direct URLs), but admins can
 * still preview them until they are made public again.
 *
 * Stored in Cloudflare D1 under the `lecture_settings` table.
 * By default, any lecture without a row in `lecture_settings` is public —
 * except in subjects with `hide_new_lectures` enabled, where a missing row
 * means the lecture is new and therefore hidden until an admin publishes it.
 */

import type { AuthDb } from './auth/db';
import { sha256Hex } from './auth/crypto';
import {
  normalizeSubjectName,
  getAutoHideLectureSubjectNames,
  SubjectVisibilityUnavailableError,
} from './subjectVisibility';

export class LectureVisibilityUnavailableError extends Error {}

export interface LectureSettingRow {
  subject_name: string;
  lecture_folder: string;
  is_public: number;
  updated_at: number;
  updated_by: string | null;
}

const KEY_SEPARATOR = '::';

/** Stable, case-insensitive composite key for a lecture. */
export function makeLectureKey(subjectName: string, lectureFolder: string): string {
  return `${normalizeSubjectName(subjectName).toLowerCase()}${KEY_SEPARATOR}${String(lectureFolder || '').trim().toLowerCase()}`;
}

/** Normalize a lecture folder name for safe comparison. */
export function normalizeLectureFolder(folder: string): string {
  return String(folder || '').trim();
}

let cachedHiddenLectureKeys: { data: Set<string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds memory cache per isolate

/** Manually invalidates the lecture visibility cache (e.g. after admin updates). */
export function invalidateLectureVisibilityCache(): void {
  cachedHiddenLectureKeys = null;
}

/** Minimal catalog shape needed to infer newly added lectures. */
export interface LectureCatalogLike {
  subject: string;
  lectures: Array<{ folderName: string }>;
}

/**
 * Returns a Set of composite keys (`subject::lecture`) for all lectures the
 * public should not see. This includes:
 *  - lectures explicitly hidden in `lecture_settings`, and
 *  - lectures in subjects with `hide_new_lectures` enabled that have no
 *    explicit visibility row (i.e. newly added lectures).
 *
 * A catalog can be supplied by callers that already have one; otherwise the
 * notes catalog is loaded lazily, and only when auto-hide is actually in use.
 * Cached in worker memory for 60 seconds per isolate. Fails closed on errors.
 */
export async function getHiddenLectureKeys(
  db?: AuthDb | null,
  catalog?: LectureCatalogLike[],
): Promise<Set<string>> {
  if (!db) {
    if (import.meta.env.DEV || (import.meta.env as any).MODE === 'test') {
      return new Set();
    }
    throw new LectureVisibilityUnavailableError('Database connection unavailable for lecture visibility check');
  }

  const now = Date.now();
  if (cachedHiddenLectureKeys && now < cachedHiddenLectureKeys.expiresAt) {
    return cachedHiddenLectureKeys.data;
  }

  try {
    const rows = await db
      .prepare('SELECT subject_name, lecture_folder, is_public FROM lecture_settings')
      .all<LectureSettingRow>();

    const hidden = new Set<string>();
    const explicit = new Set<string>();
    for (const row of rows.results ?? []) {
      if (!row.subject_name || !row.lecture_folder) continue;
      const key = makeLectureKey(row.subject_name, row.lecture_folder);
      if (Number(row.is_public) === 0) hidden.add(key);
      else explicit.add(key);
    }

    let autoHideSubjects: Set<string>;
    try {
      autoHideSubjects = await getAutoHideLectureSubjectNames(db);
    } catch (err) {
      if (err instanceof SubjectVisibilityUnavailableError) {
        throw new LectureVisibilityUnavailableError(`Auto-hide lecture setting unavailable: ${(err as Error).message}`);
      }
      throw err;
    }

    if (autoHideSubjects.size > 0) {
      let catalogToScan = catalog;
      if (!catalogToScan) {
        const { listCatalog } = await import('../utils/notesLoader');
        catalogToScan = await listCatalog();
      }
      for (const s of catalogToScan) {
        if (!autoHideSubjects.has(s.subject.trim().toLowerCase())) continue;
        for (const lec of s.lectures ?? []) {
          const key = makeLectureKey(s.subject, lec.folderName);
          if (!explicit.has(key)) hidden.add(key);
        }
      }
    }

    cachedHiddenLectureKeys = { data: hidden, expiresAt: now + CACHE_TTL_MS };
    return hidden;
  } catch (err: any) {
    if (cachedHiddenLectureKeys) {
      return cachedHiddenLectureKeys.data;
    }
    throw new LectureVisibilityUnavailableError(`Lecture visibility unavailable: ${err?.message || 'query failed'}`);
  }
}

/** Computes a 16-character hex fingerprint of the sorted hidden lecture key set. */
export async function computeHiddenLectureFingerprint(hiddenKeys: Set<string> | string[]): Promise<string> {
  const sorted = [...hiddenKeys].sort().join('|');
  const hash = await sha256Hex(sorted);
  return hash.slice(0, 16);
}

/**
 * Checks whether a single lecture is public, accounting for auto-hide
 * subjects. Defaults to true only when no DB is available.
 */
export async function isLecturePublic(
  db: AuthDb | null | undefined,
  subjectName: string,
  lectureFolder: string,
): Promise<boolean> {
  if (!db || !subjectName || !lectureFolder) return true;
  const hidden = await getHiddenLectureKeys(db);
  return !hidden.has(makeLectureKey(subjectName, lectureFolder));
}

/**
 * Computes a lecture's effective visibility from explicit settings plus the
 * subject's auto-hide flag — without needing the full catalog. Used by admin
 * listings where every lecture is already known.
 */
export function isLecturePublicBySettings(
  subjectName: string,
  lectureFolder: string,
  explicitVisibility: Map<string, boolean>,
  autoHideSubjects: Set<string>,
): boolean {
  const key = makeLectureKey(subjectName, lectureFolder);
  if (explicitVisibility.has(key)) return explicitVisibility.get(key)!;
  return !autoHideSubjects.has(normalizeSubjectName(subjectName).toLowerCase());
}

/**
 * Writes explicit visibility rows for lectures that have no row yet, using
 * the supplied default. Called when auto-hide is toggled so existing lectures
 * keep their current visibility while future ones inherit the new default.
 */
export async function seedLectureVisibilityDefaults(
  db: AuthDb,
  subjectName: string,
  lectures: Array<{ folderName: string }>,
  defaultPublic: boolean,
  adminUserId?: string,
): Promise<number> {
  const subject = normalizeSubjectName(subjectName);
  if (!subject) throw new Error('Subject name cannot be empty.');

  const existing = await listLectureVisibilityMap(db);
  const publicVal = defaultPublic ? 1 : 0;
  const now = Date.now();
  const userId = adminUserId || null;
  let inserted = 0;

  for (const lec of lectures) {
    const folder = normalizeLectureFolder(lec.folderName);
    if (!folder || existing.has(makeLectureKey(subject, folder))) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO lecture_settings (subject_name, lecture_folder, is_public, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(subject, folder, publicVal, now, userId)
      .run();
    inserted++;
  }

  if (inserted > 0) invalidateLectureVisibilityCache();
  return inserted;
}

/** Returns a map of composite lecture key -> isPublic boolean for all configured lectures. */
export async function listLectureVisibilityMap(db?: AuthDb | null): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (!db) return map;

  try {
    const rows = await db
      .prepare('SELECT subject_name, lecture_folder, is_public FROM lecture_settings')
      .all<LectureSettingRow>();

    for (const row of rows.results ?? []) {
      if (row.subject_name && row.lecture_folder) {
        map.set(makeLectureKey(row.subject_name, row.lecture_folder), Number(row.is_public) === 1);
      }
    }
  } catch {
    // Graceful fallback
  }

  return map;
}

/** Sets the visibility of a single lecture. Requires admin authentication at the API layer. */
export async function setLectureVisibility(
  db: AuthDb,
  subjectName: string,
  lectureFolder: string,
  isPublic: boolean,
  adminUserId?: string,
): Promise<{ subjectName: string; lectureFolder: string; isPublic: boolean }> {
  const subject = normalizeSubjectName(subjectName);
  const folder = normalizeLectureFolder(lectureFolder);
  if (!subject) throw new Error('Subject name cannot be empty.');
  if (!folder) throw new Error('Lecture folder cannot be empty.');

  const publicVal = isPublic ? 1 : 0;
  const now = Date.now();
  const userId = adminUserId || null;

  await db
    .prepare(
      `INSERT INTO lecture_settings (subject_name, lecture_folder, is_public, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subject_name, lecture_folder) DO UPDATE SET
         is_public = excluded.is_public,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(subject, folder, publicVal, now, userId)
    .run();

  invalidateLectureVisibilityCache();

  return { subjectName: subject, lectureFolder: folder, isPublic };
}

/** True when a lecture is hidden for the given viewer. Admins see everything. */
export function isLectureHiddenForViewer(
  subjectName: string,
  lectureFolder: string,
  hiddenKeys: Set<string>,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return false;
  return hiddenKeys.has(makeLectureKey(subjectName, lectureFolder));
}

/**
 * Removes hidden lectures from a lecture list for non-admin viewers.
 * Admins receive the original list so they can preview hidden lectures.
 */
export function filterVisibleLectures<T extends { folderName: string }>(
  lectures: T[],
  subjectName: string,
  hiddenKeys: Set<string>,
  isAdmin: boolean,
): T[] {
  if (isAdmin || hiddenKeys.size === 0) return lectures;
  return lectures.filter((l) => !isLectureHiddenForViewer(subjectName, l.folderName, hiddenKeys, isAdmin));
}
