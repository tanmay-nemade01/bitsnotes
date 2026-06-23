/**
 * D1 queries for bookmarks and collections.
 */

import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: number;
}

export interface Bookmark {
  id: string;
  user_id: string;
  collection_id: string;
  subject: string;
  lecture: string;
  display_name: string;
  created_at: number;
}

// ─── Collections ────────────────────────────────────────────────────────────

export async function listCollections(db: AuthDb, userId: string): Promise<Collection[]> {
  const result = await db.prepare(
    'SELECT * FROM collections WHERE user_id = ? ORDER BY sort_order, name',
  ).bind(userId).all<Collection>();
  return result.results ?? [];
}

export async function findCollection(db: AuthDb, userId: string, collectionId: string): Promise<Collection | null> {
  return db.prepare(
    'SELECT * FROM collections WHERE id = ? AND user_id = ?',
  ).bind(collectionId, userId).first<Collection>();
}

export async function findDefaultCollection(db: AuthDb, userId: string): Promise<Collection> {
  let col = await db.prepare(
    'SELECT * FROM collections WHERE user_id = ? AND name = ?',
  ).bind(userId, 'Saved').first<Collection>();

  if (!col) {
    col = await createCollection(db, userId, 'Saved');
  }

  return col;
}

export async function createCollection(db: AuthDb, userId: string, name: string): Promise<Collection> {
  const id = uuidv7();
  const now = Date.now();
  // Get max sort_order
  const maxOrder = await db.prepare(
    'SELECT MAX(sort_order) as max_order FROM collections WHERE user_id = ?',
  ).bind(userId).first<{ max_order: number | null }>();
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  await db.prepare(
    'INSERT INTO collections (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, userId, name.slice(0, 80), sortOrder, now).run();

  return { id, user_id: userId, name: name.slice(0, 80), sort_order: sortOrder, created_at: now };
}

export async function renameCollection(db: AuthDb, userId: string, collectionId: string, newName: string): Promise<boolean> {
  const result = await db.prepare(
    'UPDATE collections SET name = ? WHERE id = ? AND user_id = ?',
  ).bind(newName.slice(0, 80), collectionId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function deleteCollection(db: AuthDb, userId: string, collectionId: string): Promise<boolean> {
  // Move bookmarks to default collection first
  const defaultCol = await findDefaultCollection(db, userId);
  await db.prepare(
    'UPDATE bookmarks SET collection_id = ? WHERE collection_id = ? AND user_id = ?',
  ).bind(defaultCol.id, collectionId, userId).run();

  const result = await db.prepare(
    'DELETE FROM collections WHERE id = ? AND user_id = ?',
  ).bind(collectionId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

// ─── Bookmarks ──────────────────────────────────────────────────────────────

export async function listBookmarks(db: AuthDb, userId: string): Promise<Bookmark[]> {
  const result = await db.prepare(
    'SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(userId).all<Bookmark>();
  return result.results ?? [];
}

export async function findBookmark(db: AuthDb, userId: string, subject: string, lecture: string): Promise<Bookmark | null> {
  return db.prepare(
    'SELECT * FROM bookmarks WHERE user_id = ? AND subject = ? AND lecture = ?',
  ).bind(userId, subject, lecture).first<Bookmark>();
}

export async function addBookmark(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
  displayName: string,
  collectionId?: string,
): Promise<Bookmark> {
  // Use provided collection or default
  const colId = collectionId || (await findDefaultCollection(db, userId)).id;

  // Validate collection belongs to user
  const col = await findCollection(db, userId, colId);
  if (!col) throw new Error('Collection not found');

  const id = uuidv7();
  const now = Date.now();

  await db.prepare(
    'INSERT INTO bookmarks (id, user_id, collection_id, subject, lecture, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, colId, subject, lecture, displayName.slice(0, 200), now).run();

  return { id, user_id: userId, collection_id: colId, subject, lecture, display_name: displayName.slice(0, 200), created_at: now };
}

export async function removeBookmark(db: AuthDb, userId: string, subject: string, lecture: string): Promise<boolean> {
  const result = await db.prepare(
    'DELETE FROM bookmarks WHERE user_id = ? AND subject = ? AND lecture = ?',
  ).bind(userId, subject, lecture).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function moveBookmark(db: AuthDb, userId: string, bookmarkId: string, collectionId: string): Promise<boolean> {
  const col = await findCollection(db, userId, collectionId);
  if (!col) return false;

  const result = await db.prepare(
    'UPDATE bookmarks SET collection_id = ? WHERE id = ? AND user_id = ?',
  ).bind(collectionId, bookmarkId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listRecentBookmarks(db: AuthDb, userId: string, limit = 5): Promise<Bookmark[]> {
  const result = await db.prepare(
    'SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(userId, limit).all<Bookmark>();
  return result.results ?? [];
}
