/**
 * Chatbot request tracking service.
 *
 * Two tables, one request lifecycle:
 *   chatbot_requests  — inserted as `pending` before the model call, then
 *                       updated in place to `success` or `error`.
 *   chatbot_questions — inserted once per request; stores the user's question
 *                       only. Chatbot responses are never persisted.
 *
 * Tracking is best-effort except for the quota reservation, which lives in
 * `chatbotUsage.ts` and is handled by the route.
 */

import type { AuthDb } from './auth/db';
import { currentUsageMonth, refundChatbotUsageBy } from './chatbotUsage';

export type ChatbotRequestStatus = 'pending' | 'success' | 'error';

export interface ChatbotRequestStart {
  requestId: string;
  userId: string;
  conversationId: string;
  usageMonth: string;
  createdAt: number;
  reserved: boolean;
}

export interface ChatbotQuestionInput {
  requestId: string;
  conversationId: string;
  userId: string;
  questionText: string;
  turnIndex: number;
  subject: string | null;
  lectureFolder: string | null;
  lectureTitle: string | null;
  lectureNumber: number | null;
  includeTextbook: boolean;
  pageUrl: string | null;
  createdAt: number;
}

export interface ChatbotSuccessInput {
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
}

export interface ChatbotErrorInput {
  errorCode: string;
  httpStatus?: number | null;
  model?: string | null;
  latencyMs?: number | null;
  /** Refund the reserved quota slot (only when the request had one). */
  refund?: boolean;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Generate a request/conversation identifier. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual generator.
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Accept only client-supplied IDs that look safe; otherwise generate a new one. */
export function sanitizeRequestId(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (REQUEST_ID_RE.test(trimmed)) return trimmed;
  }
  return newRequestId();
}

/** Conversation IDs share the same shape as request IDs. */
export function sanitizeConversationId(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (REQUEST_ID_RE.test(trimmed)) return trimmed;
  }
  return fallback;
}

/** Parse a lecture number out of a folder name, e.g. "Lecture 03 - Search". */
export function parseLectureNumber(folder: string | null | undefined): number | null {
  if (!folder) return null;
  const explicit = folder.match(/(?:lecture|lec|week|module|class|unit)\s*[-_.#:]?\s*(\d{1,3})/i);
  const match = explicit || folder.match(/(\d{1,3})/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value >= 0 && value <= 999 ? value : null;
}

/** Derive a readable lecture title from a folder name, if possible. */
export function deriveLectureTitle(folder: string | null | undefined): string | null {
  if (!folder) return null;
  const stripped = folder
    .replace(/^(?:lecture|lec|week|module|class|unit)\s*[-_.#:]?\s*\d{1,3}\s*[-–—:.]?\s*/i, '')
    .trim();
  if (!stripped || stripped === folder) return null;
  return stripped.slice(0, 200);
}

/** Convert an unknown turn index to a safe integer. */
export function normalizeTurnIndex(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100000, Math.trunc(value)));
  }
  return Math.max(0, Math.min(100000, Math.trunc(fallback)));
}

function changesOf(result: any): number {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

/**
 * Insert the request row. Returns:
 *   'inserted'  — new row created
 *   'duplicate' — request_id already exists (idempotency hit)
 *   'error'     — database failure
 */
export async function insertRequestStart(
  db: AuthDb,
  data: ChatbotRequestStart
): Promise<'inserted' | 'duplicate' | 'error'> {
  try {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO chatbot_requests
          (request_id, user_id, conversation_id, status, usage_month, created_at, reserved)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`
      )
      .bind(
        data.requestId,
        data.userId,
        data.conversationId,
        data.usageMonth,
        data.createdAt,
        data.reserved ? 1 : 0
      )
      .run();
    return changesOf(result) > 0 ? 'inserted' : 'duplicate';
  } catch (err) {
    console.error('[chatbotTracking] Failed to insert request:', err);
    return 'error';
  }
}

/** Mark a request as holding a quota slot. */
export async function markRequestReserved(db: AuthDb, requestId: string): Promise<boolean> {
  try {
    const result = await db
      .prepare(`UPDATE chatbot_requests SET reserved = 1 WHERE request_id = ? AND status = 'pending'`)
      .bind(requestId)
      .run();
    return changesOf(result) > 0;
  } catch (err) {
    console.error('[chatbotTracking] Failed to mark request reserved:', err);
    return false;
  }
}

/** Store the user's question. Never stores the assistant response. */
export async function insertQuestion(db: AuthDb, data: ChatbotQuestionInput): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO chatbot_questions
          (request_id, conversation_id, user_id, question_text, turn_index, subject,
           lecture_folder, lecture_title, lecture_number, include_textbook, page_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.requestId,
        data.conversationId,
        data.userId,
        data.questionText,
        data.turnIndex,
        data.subject,
        data.lectureFolder,
        data.lectureTitle,
        data.lectureNumber,
        data.includeTextbook ? 1 : 0,
        data.pageUrl,
        data.createdAt
      )
      .run();
    return changesOf(result) > 0;
  } catch (err) {
    console.error('[chatbotTracking] Failed to insert question:', err);
    return false;
  }
}

/** Finalize a request as successful. */
export async function markRequestSuccess(
  db: AuthDb,
  requestId: string,
  data: ChatbotSuccessInput = {}
): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `UPDATE chatbot_requests
         SET status = 'success', finished_at = ?, latency_ms = ?, model = ?,
             prompt_tokens = ?, completion_tokens = ?
         WHERE request_id = ? AND status = 'pending'`
      )
      .bind(
        Date.now(),
        data.latencyMs ?? null,
        data.model ?? null,
        data.promptTokens ?? null,
        data.completionTokens ?? null,
        requestId
      )
      .run();
    return changesOf(result) > 0;
  } catch (err) {
    console.error('[chatbotTracking] Failed to mark request success:', err);
    return false;
  }
}

/**
 * Finalize a request as failed. When the request held a quota slot and
 * `refund` is true, the slot is returned to the user.
 */
export async function markRequestError(
  db: AuthDb,
  requestId: string,
  data: ChatbotErrorInput
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT user_id, usage_month, reserved
         FROM chatbot_requests
         WHERE request_id = ? AND status = 'pending'`
      )
      .bind(requestId)
      .first<{ user_id: string; usage_month: string; reserved: number }>();

    if (!row) return false;

    const result = await db
      .prepare(
        `UPDATE chatbot_requests
         SET status = 'error', error_code = ?, http_status = ?, finished_at = ?,
             latency_ms = ?, model = ?, reserved = 0
         WHERE request_id = ? AND status = 'pending'`
      )
      .bind(
        data.errorCode,
        data.httpStatus ?? null,
        Date.now(),
        data.latencyMs ?? null,
        data.model ?? null,
        requestId
      )
      .run();

    if (changesOf(result) > 0 && data.refund && Number(row.reserved) === 1) {
      await refundChatbotUsageBy(db, row.user_id, 1, row.usage_month);
    }

    return changesOf(result) > 0;
  } catch (err) {
    console.error('[chatbotTracking] Failed to mark request error:', err);
    return false;
  }
}

/**
 * Record an attempt that was blocked before reaching the model (quota, rate
 * limit, hidden subject, etc.). No question content is stored.
 */
export async function logBlockedRequest(
  db: AuthDb,
  data: {
    requestId: string;
    userId: string;
    conversationId: string;
    errorCode: string;
    httpStatus: number;
    usageMonth?: string;
  }
): Promise<void> {
  try {
    const now = Date.now();
    await db
      .prepare(
        `INSERT OR IGNORE INTO chatbot_requests
          (request_id, user_id, conversation_id, status, error_code, http_status,
           usage_month, created_at, finished_at, reserved)
         VALUES (?, ?, ?, 'error', ?, ?, ?, ?, ?, 0)`
      )
      .bind(
        data.requestId,
        data.userId,
        data.conversationId,
        data.errorCode,
        data.httpStatus,
        data.usageMonth || currentUsageMonth(),
        now,
        now
      )
      .run();
  } catch (err) {
    console.error('[chatbotTracking] Failed to log blocked request:', err);
  }
}

/**
 * Close out requests that have been stuck in `pending` for too long (worker
 * crash, client disconnect, upstream hang) and refund their quota slots.
 * Runs lazily for the requesting user only.
 */
export async function cleanupStalePendingRequests(
  db: AuthDb,
  userId: string,
  staleMs = 5 * 60 * 1000
): Promise<void> {
  const cutoff = Date.now() - staleMs;

  try {
    const result = await db
      .prepare(
        `SELECT request_id, usage_month, reserved
         FROM chatbot_requests
         WHERE user_id = ? AND status = 'pending' AND created_at < ?`
      )
      .bind(userId, cutoff)
      .all<{ request_id: string; usage_month: string; reserved: number }>();

    const rows = result?.results || [];
    if (rows.length === 0) return;

    for (const row of rows) {
      // Update one row at a time and only refund when this statement actually
      // closed a still-pending request. This avoids refunding a request that
      // completed successfully between the SELECT and the UPDATE.
      const update = await db
        .prepare(
          `UPDATE chatbot_requests
           SET status = 'error', error_code = 'timeout', finished_at = ?, reserved = 0
           WHERE request_id = ? AND status = 'pending'`
        )
        .bind(Date.now(), row.request_id)
        .run();

      if (changesOf(update) > 0 && Number(row.reserved) === 1) {
        await refundChatbotUsageBy(db, userId, 1, row.usage_month);
      }
    }
  } catch (err) {
    console.error('[chatbotTracking] Stale pending cleanup failed:', err);
  }
}
