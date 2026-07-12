/**
 * Page feedback data-access layer (Phase 5: "Was this useful?").
 *
 * All queries are parameterized. The visitor is identified only by an HMAC of
 * their functional cookie — never the raw cookie. Votes upsert on the UNIQUE
 * key (page_type, subject, lecture, visitor_hash) so a visitor can change
 * their vote. The optional `reason` is stored but NOT returned by GET in v1.
 */

import type { AuthDb } from './auth/db';
import { uuidv7 } from './auth/crypto';

export type PageType = 'lecture' | 'subject';
export type FeedbackValue = 1 | -1;

export interface FeedbackAggregate {
  useful: number;
  notYet: number;
  myVote: FeedbackValue | null;
}

export interface UpsertInput {
  pageType: PageType;
  subject: string;
  lecture: string | null;
  visitorHash: string;
  value: FeedbackValue;
  reason: string | null;
}

/**
 * Aggregate counts for a page, plus the calling visitor's current vote.
 */
export async function getFeedbackAggregate(
  db: AuthDb,
  opts: { pageType: PageType; subject: string; lecture: string | null; visitorHash: string | null },
): Promise<FeedbackAggregate> {
  const lec = opts.lecture ?? null;
  const row = await db.prepare(
    `SELECT
        SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS useful,
        SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS notYet
     FROM page_feedback
     WHERE page_type = ? AND subject = ? AND (lecture IS ? AND ? IS NULL OR lecture = ?)`,
  )
    .bind(opts.pageType, opts.subject, lec, lec, lec)
    .first<{ useful: number | null; notYet: number | null }>();

  let myVote: FeedbackValue | null = null;
  if (opts.visitorHash) {
    const mine = await db.prepare(
      `SELECT value FROM page_feedback
       WHERE page_type = ? AND subject = ? AND (lecture IS ? AND ? IS NULL OR lecture = ?) AND visitor_hash = ?`,
    )
      .bind(opts.pageType, opts.subject, lec, lec, lec, opts.visitorHash)
      .first<{ value: number }>();
    if (mine) myVote = (mine.value === 1 ? 1 : -1) as FeedbackValue;
  }

  return {
    useful: row?.useful ?? 0,
    notYet: row?.notYet ?? 0,
    myVote,
  };
}

/**
 * Upsert a vote on the UNIQUE key. If the visitor already voted, the value and
 * reason are updated (and updated_at bumped). Returns the stored value.
 */
export async function upsertFeedback(db: AuthDb, input: UpsertInput): Promise<FeedbackValue> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO page_feedback (id, page_type, subject, lecture, visitor_hash, value, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(page_type, subject, lecture, visitor_hash)
     DO UPDATE SET value = excluded.value, reason = excluded.reason, updated_at = excluded.updated_at`,
  )
    .bind(
      uuidv7(),
      input.pageType,
      input.subject,
      input.lecture,
      input.visitorHash,
      input.value,
      input.reason,
      now,
      now,
    )
    .run();
  return input.value;
}
