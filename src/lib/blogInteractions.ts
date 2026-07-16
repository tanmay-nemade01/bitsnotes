import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';

export interface BlogLike {
  id: string;
  user_id: string;
  slug: string;
  created_at: number;
}

export interface BlogFollow {
  id: string;
  user_id: string;
  author: string;
  created_at: number;
}

export async function getLikeCount(db: AuthDb, slug: string): Promise<number> {
  const row = await db.prepare(
    'SELECT COUNT(*) AS count FROM blog_likes WHERE slug = ?',
  ).bind(slug).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserLike(db: AuthDb, userId: string, slug: string): Promise<BlogLike | null> {
  return db.prepare(
    'SELECT * FROM blog_likes WHERE user_id = ? AND slug = ?',
  ).bind(userId, slug).first<BlogLike>();
}

export async function toggleLike(db: AuthDb, userId: string, slug: string): Promise<{ liked: boolean; count: number }> {
  const existing = await getUserLike(db, userId, slug);
  if (existing) {
    await db.prepare(
      'DELETE FROM blog_likes WHERE user_id = ? AND slug = ?',
    ).bind(userId, slug).run();
  } else {
    const id = uuidv7();
    const now = Date.now();
    await db.prepare(
      'INSERT INTO blog_likes (id, user_id, slug, created_at) VALUES (?, ?, ?, ?)',
    ).bind(id, userId, slug, now).run();
  }
  const count = await getLikeCount(db, slug);
  return { liked: !existing, count };
}

export async function getFollowCount(db: AuthDb, author: string): Promise<number> {
  const row = await db.prepare(
    'SELECT COUNT(*) AS count FROM blog_follows WHERE author = ?',
  ).bind(author).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserFollow(db: AuthDb, userId: string, author: string): Promise<BlogFollow | null> {
  return db.prepare(
    'SELECT * FROM blog_follows WHERE user_id = ? AND author = ?',
  ).bind(userId, author).first<BlogFollow>();
}

export async function toggleFollow(db: AuthDb, userId: string, author: string): Promise<{ following: boolean; count: number }> {
  const existing = await getUserFollow(db, userId, author);
  if (existing) {
    await db.prepare(
      'DELETE FROM blog_follows WHERE user_id = ? AND author = ?',
    ).bind(userId, author).run();
  } else {
    const id = uuidv7();
    const now = Date.now();
    await db.prepare(
      'INSERT INTO blog_follows (id, user_id, author, created_at) VALUES (?, ?, ?, ?)',
    ).bind(id, userId, author, now).run();
  }
  const count = await getFollowCount(db, author);
  return { following: !existing, count };
}
