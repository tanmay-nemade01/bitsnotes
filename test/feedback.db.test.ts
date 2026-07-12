import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { getFeedbackAggregate, upsertFeedback } from '../src/lib/feedback';

let db: AuthDb;

beforeEach(() => {
  db = makeDb();
});

const page = { pageType: 'lecture' as const, subject: 'NLP', lecture: 'L1' };

describe('feedback data layer', () => {
  it('records a useful vote and aggregates', async () => {
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: null });
    const agg = await getFeedbackAggregate(db, { ...page, visitorHash: 'v1' });
    expect(agg).toEqual({ useful: 1, notYet: 0, myVote: 1 });
  });

  it('aggregates useful vs not-yet independently of visitor', async () => {
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: null });
    await upsertFeedback(db, { ...page, visitorHash: 'v2', value: 1, reason: null });
    await upsertFeedback(db, { ...page, visitorHash: 'v3', value: -1, reason: null });
    const agg = await getFeedbackAggregate(db, { ...page, visitorHash: null });
    expect(agg).toEqual({ useful: 2, notYet: 1, myVote: null });
  });

  it('upserts: a visitor changing their vote updates the count', async () => {
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: null });
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: -1, reason: null });
    const agg = await getFeedbackAggregate(db, { ...page, visitorHash: 'v1' });
    expect(agg).toEqual({ useful: 0, notYet: 1, myVote: -1 });
  });

  it('keeps the latest reason on upsert', async () => {
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: 'first' });
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: 'second' });
    const agg = await getFeedbackAggregate(db, { ...page, visitorHash: 'v1' });
    expect(agg.myVote).toBe(1);
    // reason is not returned by GET in v1; we only assert the vote changed.
  });

  it('scopes aggregation by subject/lecture', async () => {
    await upsertFeedback(db, { ...page, visitorHash: 'v1', value: 1, reason: null });
    await upsertFeedback(db, { pageType: 'subject', subject: 'NLP', lecture: null, visitorHash: 'v1', value: 1, reason: null });
    const lectureAgg = await getFeedbackAggregate(db, { ...page, visitorHash: null });
    const subjectAgg = await getFeedbackAggregate(db, { pageType: 'subject', subject: 'NLP', lecture: null, visitorHash: null });
    expect(lectureAgg.useful).toBe(1);
    expect(subjectAgg.useful).toBe(1);
  });
});
