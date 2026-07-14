/**
 * D1 queries for reading progress tracking.
 */

import type { AuthDb } from './auth/db';

export interface ReadingProgress {
  user_id: string;
  subject: string;
  lecture: string;
  read_pct: number;
  last_read_at: number;
}

/**
 * Mark a lecture as read (upsert with max read percentage).
 */
export async function markRead(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
  readPct: number,
): Promise<void> {
  const clampedPct = Math.min(100, Math.max(0, Math.round(readPct)));
  const now = Date.now();

  await db.prepare(
    `INSERT INTO reading_progress (user_id, subject, lecture, read_pct, last_read_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, subject, lecture)
     DO UPDATE SET
       read_pct = MAX(reading_progress.read_pct, excluded.read_pct),
       last_read_at = excluded.last_read_at`,
  ).bind(userId, subject, lecture, clampedPct, now).run();
}

/**
 * Get progress for all lectures in a subject.
 */
export async function listProgress(
  db: AuthDb,
  userId: string,
  subject: string,
): Promise<{ lecture: string; readPct: number; lastReadAt: number }[]> {
  const result = await db.prepare(
    'SELECT lecture, read_pct as readPct, last_read_at as lastReadAt FROM reading_progress WHERE user_id = ? AND subject = ?',
  ).bind(userId, subject).all<{ lecture: string; readPct: number; lastReadAt: number }>();
  return result.results ?? [];
}

/**
 * Get overall progress summary across all subjects.
 */
export async function getProgressSummary(
  db: AuthDb,
  userId: string,
): Promise<Record<string, { read: number; total: number; percent: number }>> {
  const result = await db.prepare(
    'SELECT subject, lecture, read_pct FROM reading_progress WHERE user_id = ?',
  ).bind(userId).all<{ subject: string; lecture: string; read_pct: number }>();

  const bySubject: Record<string, { read: number; total: number; percent: number }> = {};
  for (const row of result.results ?? []) {
    if (!bySubject[row.subject]) {
      bySubject[row.subject] = { read: 0, total: 0, percent: 0 };
    }
    bySubject[row.subject].total++;
    if (row.read_pct >= 80) {
      bySubject[row.subject].read++;
    }
  }

  // Calculate percentages
  for (const subj of Object.values(bySubject)) {
    subj.percent = subj.total > 0 ? Math.round((subj.read / subj.total) * 100) : 0;
  }

  return bySubject;
}

/**
 * Get progress for a single lecture (returns null if no record).
 */
export async function getLectureProgress(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
): Promise<ReadingProgress | null> {
  return db.prepare(
    'SELECT * FROM reading_progress WHERE user_id = ? AND subject = ? AND lecture = ?',
  ).bind(userId, subject, lecture).first<ReadingProgress>();
}

/**
 * Get topic-level progress for a single lecture.
 */
export async function listTopicProgress(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
): Promise<{ topicId: string; readPct: number; lastReadAt: number }[]> {
  const result = await db.prepare(
    'SELECT topic_id as topicId, read_pct as readPct, last_read_at as lastReadAt FROM topic_progress WHERE user_id = ? AND subject = ? AND lecture = ?',
  ).bind(userId, subject, lecture).all<{ topicId: string; readPct: number; lastReadAt: number }>();
  return result.results ?? [];
}

/**
 * Mark a topic as read and recompute the overall lecture progress.
 */
export async function markTopicProgress(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
  topicId: string,
  readPct: number,
  totalTopics: number,
): Promise<void> {
  const clampedPct = Math.min(100, Math.max(0, Math.round(readPct)));
  const now = Date.now();

  // 1. Upsert the topic-specific progress
  await db.prepare(
    `INSERT INTO topic_progress (user_id, subject, lecture, topic_id, read_pct, last_read_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, subject, lecture, topic_id)
     DO UPDATE SET
       read_pct = MAX(topic_progress.read_pct, excluded.read_pct),
       last_read_at = excluded.last_read_at`,
  ).bind(userId, subject, lecture, topicId, clampedPct, now).run();

  // 2. Count topics completed (read_pct >= 80)
  const completedResult = await db.prepare(
    `SELECT COUNT(*) as count FROM topic_progress
     WHERE user_id = ? AND subject = ? AND lecture = ? AND read_pct >= 80`,
  ).bind(userId, subject, lecture).first<{ count: number }>();

  const completedCount = completedResult?.count ?? 0;

  // 3. Compute overall lecture read_pct (capped at 100)
  const lectureReadPct = totalTopics > 0 ? Math.min(100, Math.round((completedCount / totalTopics) * 100)) : 0;

  // 4. Upsert the lecture-wide reading progress
  await db.prepare(
    `INSERT INTO reading_progress (user_id, subject, lecture, read_pct, last_read_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, subject, lecture)
     DO UPDATE SET
       read_pct = MAX(reading_progress.read_pct, excluded.read_pct),
       last_read_at = excluded.last_read_at`,
  ).bind(userId, subject, lecture, lectureReadPct, now).run();
}
