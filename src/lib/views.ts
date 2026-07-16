/**
 * Page views data-access layer.
 *
 * Tracks global view counts per page, stored in the `page_views` D1 table.
 *
 * page_key format:
 *   home                          → home page
 *   blog:{slug}                   → blog post
 *   lecture:{subject}:{lecture}   → lecture notes page
 *
 * Seed offsets (added at row-creation time so counts never start at zero):
 *   home            → random 10000–11000
 *   blog posts      → random 50–60
 *   lecture pages   → random 400–500
 *
 * Each seed is deterministic per page (hash of the key), so re-running
 * migrations never double-seeds. The actual DB value is  offset + real_views.
 */

import type { AuthDb } from './auth/db';

// ─── Key helpers ──────────────────────────────────────────────────────────────

export function homeKey(): string {
  return 'home';
}

export function blogKey(slug: string): string {
  return `blog:${slug}`;
}

export function lectureKey(subject: string, lecture: string): string {
  return `lecture:${subject}:${lecture}`;
}

// ─── Seed offsets ─────────────────────────────────────────────────────────────

/**
 * A lightweight deterministic pseudorandom integer in [min, max] derived from
 * a string key, so every page always gets the same seed offset across deploys.
 */
function seedOffset(key: string, min: number, max: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0; // djb2, keep as uint32
  }
  return min + (h % (max - min + 1));
}

export function seedOffsetForKey(key: string): number {
  if (key === 'home') return seedOffset(key, 10000, 11000);
  if (key.startsWith('blog:')) return seedOffset(key, 50, 60);
  return seedOffset(key, 400, 500); // lecture
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Increment the view count for a page by 1, creating the row (with its seed
 * offset) if it does not yet exist. Returns the new total view count.
 */
export async function incrementViews(db: AuthDb, key: string): Promise<number> {
  const offset = seedOffsetForKey(key);

  // INSERT OR IGNORE seeds new rows at the offset so first real view shows a
  // realistic non-zero count. Subsequent increments just add 1.
  await db
    .prepare(
      `INSERT OR IGNORE INTO page_views (page_key, views) VALUES (?, ?)`,
    )
    .bind(key, offset)
    .run();

  const row = await db
    .prepare(
      `UPDATE page_views SET views = views + 1 WHERE page_key = ? RETURNING views`,
    )
    .bind(key)
    .first<{ views: number }>();

  return row?.views ?? offset + 1;
}

/**
 * Get the current view count for a page without incrementing. Returns the
 * seed offset if the row does not exist yet (i.e. no real visits so far).
 */
export async function getViews(db: AuthDb, key: string): Promise<number> {
  const row = await db
    .prepare(`SELECT views FROM page_views WHERE page_key = ?`)
    .bind(key)
    .first<{ views: number }>();

  return row?.views ?? seedOffsetForKey(key);
}

/**
 * Batch-fetch view counts for multiple keys. Returns a map of key → views.
 * Missing rows fall back to the seed offset.
 */
export async function getViewsBatch(
  db: AuthDb,
  keys: string[],
): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();

  const placeholders = keys.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT page_key, views FROM page_views WHERE page_key IN (${placeholders})`)
    .bind(...keys)
    .all<{ page_key: string; views: number }>();

  const result = new Map<string, number>();
  for (const row of rows.results ?? []) {
    result.set(row.page_key, row.views);
  }
  // Fill in seed offsets for any keys not yet in the DB
  for (const key of keys) {
    if (!result.has(key)) {
      result.set(key, seedOffsetForKey(key));
    }
  }
  return result;
}
