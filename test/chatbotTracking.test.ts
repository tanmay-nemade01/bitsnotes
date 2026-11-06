import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  cleanupStalePendingRequests,
  deriveLectureTitle,
  insertQuestion,
  insertRequestStart,
  markRequestError,
  markRequestReserved,
  markRequestSuccess,
  parseLectureNumber,
  sanitizeConversationId,
  sanitizeRequestId,
} from '../src/lib/chatbotTracking';
import { getChatbotUsage, reserveChatbotUsage } from '../src/lib/chatbotUsage';
import {
  DEFAULT_CHATBOT_MODELS,
  clearChatbotModel,
  getChatbotModel,
  setChatbotModel,
} from '../src/lib/chatbotSettings';

let db: AuthDb;

const MONTH = '2026-10';

async function seedUser(id: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at, status)
       VALUES (?, ?, 'Test User', ?, ?, 'active')`
    )
    .bind(id, `${id}@example.com`, now, now)
    .run();
}

function requestId(n: number): string {
  return `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
}

beforeEach(() => {
  db = makeDb();
});

describe('chatbotTracking', () => {
  it('inserts one request row, stores the question, and marks success', async () => {
    await seedUser('u1');
    const id = requestId(1);
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const now = Date.now();

    expect(
      await insertRequestStart(db, {
        requestId: id,
        userId: 'u1',
        conversationId,
        usageMonth: MONTH,
        createdAt: now,
        reserved: false,
      })
    ).toBe('inserted');

    expect(
      await insertRequestStart(db, {
        requestId: id,
        userId: 'u1',
        conversationId,
        usageMonth: MONTH,
        createdAt: now,
        reserved: false,
      })
    ).toBe('duplicate');

    expect(
      await insertQuestion(db, {
        requestId: id,
        conversationId,
        userId: 'u1',
        questionText: 'What is an inverted index?',
        turnIndex: 0,
        subject: 'Information Retrieval',
        lectureFolder: 'Lecture 03 - Indexing',
        lectureTitle: 'Indexing',
        lectureNumber: 3,
        includeTextbook: true,
        pageUrl: '/view/Information-Retrieval/Lecture-03',
        createdAt: now,
      })
    ).toBe(true);

    expect(await markRequestSuccess(db, id, { model: 'test/model', latencyMs: 42 })).toBe(true);

    const request = await db
      .prepare('SELECT status, model, latency_ms FROM chatbot_requests WHERE request_id = ?')
      .bind(id)
      .first<any>();
    expect(request.status).toBe('success');
    expect(request.model).toBe('test/model');
    expect(request.latency_ms).toBe(42);

    const question = await db
      .prepare('SELECT question_text, conversation_id FROM chatbot_questions WHERE request_id = ?')
      .bind(id)
      .first<any>();
    expect(question.question_text).toBe('What is an inverted index?');
    expect(question.conversation_id).toBe(conversationId);
  });

  it('refunds the quota slot when a reserved request fails', async () => {
    await seedUser('u2');
    const id = requestId(2);

    expect(await reserveChatbotUsage(db, 'u2', 20, MONTH)).toBe(true);
    await insertRequestStart(db, {
      requestId: id,
      userId: 'u2',
      conversationId: id,
      usageMonth: MONTH,
      createdAt: Date.now(),
      reserved: false,
    });
    expect(await markRequestReserved(db, id)).toBe(true);

    let usage = await getChatbotUsage(db, 'u2', false, MONTH);
    expect(usage.used).toBe(1);

    expect(
      await markRequestError(db, id, {
        errorCode: 'upstream_http',
        httpStatus: 503,
        refund: true,
      })
    ).toBe(true);

    usage = await getChatbotUsage(db, 'u2', false, MONTH);
    expect(usage.used).toBe(0);
  });

  it('cleans up stale pending requests and refunds them', async () => {
    await seedUser('u3');
    const id = requestId(3);

    expect(await reserveChatbotUsage(db, 'u3', 20, MONTH)).toBe(true);
    await insertRequestStart(db, {
      requestId: id,
      userId: 'u3',
      conversationId: id,
      usageMonth: MONTH,
      createdAt: Date.now() - 10 * 60 * 1000,
      reserved: true,
    });

    let usage = await getChatbotUsage(db, 'u3', false, MONTH);
    expect(usage.used).toBe(1);

    await cleanupStalePendingRequests(db, 'u3', 5 * 60 * 1000);

    usage = await getChatbotUsage(db, 'u3', false, MONTH);
    expect(usage.used).toBe(0);

    const request = await db
      .prepare('SELECT status, error_code FROM chatbot_requests WHERE request_id = ?')
      .bind(id)
      .first<any>();
    expect(request.status).toBe('error');
    expect(request.error_code).toBe('timeout');
  });

  it('parses lecture numbers and titles from folder names', () => {
    expect(parseLectureNumber('Lecture 03 - Search')).toBe(3);
    expect(parseLectureNumber('Week 12: Evaluation')).toBe(12);
    expect(parseLectureNumber('IR_Lecture_11_notes')).toBe(11);
    expect(parseLectureNumber('L05')).toBe(5);
    expect(parseLectureNumber('')).toBeNull();

    expect(deriveLectureTitle('Lecture 03 - Search')).toBe('Search');
    expect(deriveLectureTitle('Week 12: Evaluation')).toBe('Evaluation');
    expect(deriveLectureTitle('Search')).toBeNull();
  });

  it('sanitizes request and conversation identifiers', () => {
    expect(sanitizeRequestId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(sanitizeRequestId('bad id with spaces')).not.toBe('bad id with spaces');
    expect(sanitizeConversationId('', 'fallback-id')).toBe('fallback-id');
    expect(sanitizeConversationId('conversation-123', 'fallback-id')).toBe('conversation-123');
  });
});

describe('chatbotSettings', () => {
  it('uses defaults, persists a custom model, and resets', async () => {
    const initial = await getChatbotModel(db);
    expect(initial.isDefault).toBe(true);
    expect(initial.models).toEqual(DEFAULT_CHATBOT_MODELS);

    await setChatbotModel(db, 'google/gemma-4-31b-it:free', 'admin-1');
    const custom = await getChatbotModel(db);
    expect(custom.isDefault).toBe(false);
    expect(custom.model).toBe('google/gemma-4-31b-it:free');
    expect(custom.models).toEqual(['google/gemma-4-31b-it:free']);

    await clearChatbotModel(db);
    const reset = await getChatbotModel(db);
    expect(reset.isDefault).toBe(true);
    expect(reset.models).toEqual(DEFAULT_CHATBOT_MODELS);
  });
});
