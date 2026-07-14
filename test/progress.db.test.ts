import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  markRead,
  listProgress,
  getLectureProgress,
  listTopicProgress,
  markTopicProgress,
} from '../src/lib/progress';

let db: AuthDb;

beforeEach(async () => {
  db = makeDb();
  // Insert test user to satisfy foreign key constraints
  await db.prepare(
    `INSERT INTO users (id, email, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).bind('user1', 'user1@example.com', Date.now(), Date.now()).run();
});

describe('progress data layer', () => {
  it('marks a lecture as read and retrieves it', async () => {
    await markRead(db, 'user1', 'NLP', 'L1', 50);
    const progress = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(progress).toBeTruthy();
    expect(progress!.read_pct).toBe(50);

    // updates with max read_pct
    await markRead(db, 'user1', 'NLP', 'L1', 30); // lower should not overwrite
    const p2 = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(p2!.read_pct).toBe(50);

    await markRead(db, 'user1', 'NLP', 'L1', 85); // higher should overwrite
    const p3 = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(p3!.read_pct).toBe(85);
  });

  it('lists progress for all lectures in a subject', async () => {
    await markRead(db, 'user1', 'NLP', 'L1', 40);
    await markRead(db, 'user1', 'NLP', 'L2', 90);
    await markRead(db, 'user1', 'Math', 'L1', 100); // different subject

    const list = await listProgress(db, 'user1', 'NLP');
    expect(list).toHaveLength(2);
    expect(list.find(l => l.lecture === 'L1')!.readPct).toBe(40);
    expect(list.find(l => l.lecture === 'L2')!.readPct).toBe(90);
  });

  it('marks topic progress and calculates aggregate parent lecture read_pct', async () => {
    // 5 total topics. We complete 1.
    // Progress is (1 / 5) * 100 = 20%
    await markTopicProgress(db, 'user1', 'NLP', 'L1', '9.1', 80, 5);

    const tpList = await listTopicProgress(db, 'user1', 'NLP', 'L1');
    expect(tpList).toHaveLength(1);
    expect(tpList[0].topicId).toBe('9.1');
    expect(tpList[0].readPct).toBe(80);

    const lecProgress = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(lecProgress!.read_pct).toBe(20);

    // Complete another topic.
    // Progress is (2 / 5) * 100 = 40%
    await markTopicProgress(db, 'user1', 'NLP', 'L1', '9.2', 100, 5);
    const lp2 = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(lp2!.read_pct).toBe(40);

    // Add an incomplete topic (readPct < 80).
    // Progress should still be 40% (since it's not completed)
    await markTopicProgress(db, 'user1', 'NLP', 'L1', '9.3', 50, 5);
    const lp3 = await getLectureProgress(db, 'user1', 'NLP', 'L1');
    expect(lp3!.read_pct).toBe(40);
  });
});
