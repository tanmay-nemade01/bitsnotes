/**
 * POST /api/chatbot/chat
 * Server-side proxy for BitsNotes AI chatbot mode.
 * - Requires authenticated user (session cookie)
 * - Enforces a daily message limit per user via D1 chatbot_usage table (admins exempt).
 *   The limit is intentionally internal (fair-use policy) and must not be exposed to users.
 * - Reserves the quota slot atomically BEFORE calling the model, and refunds it
 *   on failure, so concurrent requests cannot bypass the limit.
 * - Tracks every request in chatbot_requests (pending → success/error) and stores
 *   the user's question in chatbot_questions. Chatbot responses are never stored.
 * - Augments the system prompt with up to 2 related-lecture snippets from
 *   the same subject (lean keyword retrieval, edge-cached, non-fatal) plus
 *   up to 1 per-subject textbook excerpt (opt-out via includeTextbook=false)
 * - Proxies to OpenRouter API with server-side API key
 * - Returns friendly error message on any upstream failure
 */

import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/getEnv';
import { getHiddenSubjectNames, SubjectVisibilityUnavailableError } from '../../../lib/subjectVisibility';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import {
  buildBaseSystemPrompt,
  buildCompanionBlock,
  buildCurrentLectureBlock,
  buildRelatedBlock,
  getCompanionSnippets,
  getCurrentLectureContext,
  getLastUserQuery,
  getRelatedSnippets,
  normalizeAssistantReply,
  parseSubjectFromSystemPrompt,
  shouldRetrieveCompanion,
  shouldRetrieveRelated,
  type CurrentLectureContext,
} from '../../../lib/chatbotRetrieval';
import {
  currentUsageDay,
  getUserChatbotLimit,
  refundChatbotUsage,
  reserveChatbotUsage,
} from '../../../lib/chatbotUsage';
import { getChatbotModel } from '../../../lib/chatbotSettings';
import {
  cleanupStalePendingRequests,
  deriveLectureTitle,
  insertQuestion,
  insertRequestStart,
  logBlockedRequest,
  markRequestError,
  markRequestReserved,
  markRequestSuccess,
  normalizeTurnIndex,
  parseLectureNumber,
  sanitizeConversationId,
  sanitizeRequestId,
} from '../../../lib/chatbotTracking';

export const prerender = false;

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_STORED_QUESTION_LENGTH = 4000;

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function safeString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLength);
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = (locals as any).user;
  const isAdmin = Boolean((locals as any).isAdmin);
  if (!user) {
    return jsonResponse({ error: 'Authentication required. Please sign in to use BitsNotes AI.' }, 401);
  }

  const env = await getEnv();
  const db = env.DB;
  const usageDay = currentUsageDay();
  const startedAt = Date.now();

  // ─── Parse request body (needed for request/conversation IDs) ────────
  let body: {
    messages?: Array<{ role?: string; content?: unknown }>;
    subject?: string;
    lectureFolder?: string;
    query?: string;
    includeTextbook?: boolean;
    request_id?: string;
    conversation_id?: string;
    turn_index?: number;
    page_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const requestId = sanitizeRequestId(body.request_id);
  const conversationId = sanitizeConversationId(body.conversation_id, requestId);

  // ─── Access checks ───────────────────────────────────────────────────
  if (!isAdmin && user.accessExpiresAt && Date.now() > user.accessExpiresAt) {
    if (db) {
      await logBlockedRequest(db, {
        requestId,
        userId: user.id,
        conversationId,
        errorCode: 'access_expired',
        httpStatus: 403,
        usageDay,
      });
    }
    return jsonResponse({ error: 'Your access has expired. Please contact an administrator or support to renew access.' }, 403);
  }

  if (!validateOrigin(request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  if (!db) {
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  const openrouterKey = env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    await logBlockedRequest(db, {
      requestId,
      userId: user.id,
      conversationId,
      errorCode: 'config_missing',
      httpStatus: 503,
      usageDay,
    });
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  // ─── Burst rate limiting (10 req/min) ────────────────────────────────
  const rateLimiter = env.CHATBOT_RATE_LIMITER;
  if (rateLimiter) {
    try {
      const rl = await rateLimiter.limit({ key: user.id });
      if (!rl.success) {
        await logBlockedRequest(db, {
          requestId,
          userId: user.id,
          conversationId,
          errorCode: 'rate_limited',
          httpStatus: 429,
          usageDay,
        });
        return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 429);
      }
    } catch {
      // Rate limiter unavailable — proceed without burst protection
    }
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    await logBlockedRequest(db, {
      requestId,
      userId: user.id,
      conversationId,
      errorCode: 'invalid_request',
      httpStatus: 400,
      usageDay,
    });
    return jsonResponse({ error: 'Messages array is required.' }, 400);
  }

  // ─── Progressive retrieval: current lecture + intent-gated auxiliary sources ────
  let subject = safeString(body.subject, 120);
  let excludeFolder = safeString(body.lectureFolder, 160);
  const rawQuery = safeString(
    body.query || getLastUserQuery(body.messages),
    MAX_STORED_QUESTION_LENGTH
  );
  const query = rawQuery.slice(0, 1000);
  const includeTextbook = body.includeTextbook !== false;

  if (!rawQuery) {
    await logBlockedRequest(db, {
      requestId,
      userId: user.id,
      conversationId,
      errorCode: 'invalid_request',
      httpStatus: 400,
      usageDay,
    });
    return jsonResponse({ error: 'A question is required.' }, 400);
  }

  const systemMsgForParse = body.messages.find((m) => m?.role === 'system');
  if ((!subject || !excludeFolder) && systemMsgForParse && typeof systemMsgForParse.content === 'string') {
    const parsed = parseSubjectFromSystemPrompt(systemMsgForParse.content);
    if (!subject) subject = parsed.subject;
    if (!excludeFolder) excludeFolder = parsed.lectureFolder;
  }

  if (!isAdmin && subject) {
    try {
      const hiddenSubjects = await getHiddenSubjectNames(db);
      if (hiddenSubjects.has(subject)) {
        await logBlockedRequest(db, {
          requestId,
          userId: user.id,
          conversationId,
          errorCode: 'blocked_subject',
          httpStatus: 404,
          usageDay,
        });
        return jsonResponse({ error: 'Subject not found.' }, 404);
      }
    } catch (err) {
      if (err instanceof SubjectVisibilityUnavailableError) {
        return jsonResponse({ error: 'Subject visibility unavailable' }, 503);
      }
      throw err;
    }
  }

  // ─── Create the request row BEFORE the model call ────────────────────
  // This is the audit record: it exists even if the upstream call hangs or the
  // worker dies. The quota slot is reserved immediately afterwards.
  const insertResult = await insertRequestStart(db, {
    requestId,
    userId: user.id,
    conversationId,
    usageDay,
    createdAt: startedAt,
    reserved: false,
  });

  if (insertResult === 'duplicate') {
    return jsonResponse({ error: 'This request was already submitted. Please try again.' }, 409);
  }
  if (insertResult === 'error') {
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  // ─── Atomic daily quota reservation (admins bypass) ──────────────────
  let reserved = false;
  if (!isAdmin) {
    try {
      await cleanupStalePendingRequests(db, user.id);
      const limit = await getUserChatbotLimit(db, user.id);
      reserved = await reserveChatbotUsage(db, user.id, limit, usageDay);
    } catch (err) {
      console.error('[chatbot/chat] Quota reservation failed:', err);
      await markRequestError(db, requestId, {
        errorCode: 'internal',
        httpStatus: 503,
        latencyMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    if (!reserved) {
      await markRequestError(db, requestId, {
        errorCode: 'quota_exceeded',
        httpStatus: 429,
        latencyMs: Date.now() - startedAt,
      });

      // Intentionally omit usage numbers: the fair-use threshold is internal.
      return jsonResponse({
        error: "You've reached today's fair-use limit. Please try again tomorrow.",
        limitReached: true,
      }, 429);
    }

    const marked = await markRequestReserved(db, requestId);
    if (!marked) {
      // We could not persist the reservation; refund and fail closed rather than
      // leaving an untracked quota slot.
      try {
        await refundChatbotUsage(db, user.id, usageDay);
      } catch (err) {
        console.error('[chatbot/chat] Failed to refund unreserved request:', err);
      }
      await markRequestError(db, requestId, {
        errorCode: 'internal',
        httpStatus: 503,
        latencyMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }
  }

  // ─── Store the question (content only, never the response) ───────────
  const userTurns = body.messages.filter(
    (m) => m && m.role === 'user' && typeof m.content === 'string'
  ).length;
  const turnIndex = normalizeTurnIndex(body.turn_index, Math.max(0, userTurns - 1));

  await insertQuestion(db, {
    requestId,
    conversationId,
    userId: user.id,
    questionText: rawQuery,
    turnIndex,
    subject: subject && subject !== 'Subject' ? subject : null,
    lectureFolder: excludeFolder || null,
    lectureTitle: deriveLectureTitle(excludeFolder),
    lectureNumber: parseLectureNumber(excludeFolder),
    includeTextbook,
    pageUrl: safeString(body.page_url, 500) || null,
    createdAt: startedAt,
  });

  // 1. Fetch current lecture section chunks (non-fatal)
  let lectureContext: CurrentLectureContext = {
    text: '',
    confidence: 0,
    hasHighConfidenceMatch: false,
    matchedSections: [],
    toString() {
      return this.text;
    },
  };
  try {
    if (subject && excludeFolder) {
      lectureContext = await getCurrentLectureContext({
        subject,
        lectureFolder: excludeFolder,
        query,
      });
    }
  } catch (err) {
    console.error('[chatbot/chat] Current lecture retrieval failed (non-fatal):', err);
  }

  // 2. Intent-gated auxiliary retrieval
  const needRelated = shouldRetrieveRelated({
    query,
    hasHighConfidenceMatch: lectureContext.hasHighConfidenceMatch,
  });

  const needCompanion = shouldRetrieveCompanion({
    query,
    includeTextbook,
    hasHighConfidenceMatch: lectureContext.hasHighConfidenceMatch,
    isLectureContextSparse: !lectureContext.text || lectureContext.text.length < 400,
  });

  let relatedBlock = '';
  let companionBlock = '';
  let relatedSources: Array<{ kind: string; title: string; folderName: string; slug: string }> = [];
  try {
    const [lectureSnippets, companionSnippets] = await Promise.all([
      needRelated && subject && excludeFolder
        ? getRelatedSnippets({ subject, excludeFolder, query })
        : Promise.resolve([]),
      needCompanion && subject
        ? getCompanionSnippets({ subject, query })
        : Promise.resolve([]),
    ]);
    if (lectureSnippets.length > 0) {
      relatedBlock = buildRelatedBlock(lectureSnippets);
      relatedSources = lectureSnippets.map((s) => ({
        kind: 'lecture',
        title: s.title,
        folderName: s.folderName,
        slug: s.slug,
      }));
    }
    if (companionSnippets.length > 0) {
      companionBlock = buildCompanionBlock(companionSnippets);
      for (const s of companionSnippets) {
        relatedSources.push({
          kind: 'textbook',
          title: s.title,
          folderName: s.chapterId,
          slug: s.chapterId,
        });
      }
    }
  } catch (err) {
    console.error('[chatbot/chat] Auxiliary retrieval failed (non-fatal):', err);
  }

  // 3. Assemble lean tiered context block server-side
  const baseSystemPrompt = buildBaseSystemPrompt(subject);
  const currentLectureBlock = buildCurrentLectureBlock(subject, excludeFolder, lectureContext.text);

  const fullSystemPrompt = [
    baseSystemPrompt,
    currentLectureBlock,
    relatedBlock,
    companionBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  // 4. Construct rolling upstream conversation turns (max 6 turns)
  const conversationTurns = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: (m.content as string).slice(0, 2000),
    }));

  const upstreamMessages = [
    { role: 'system', content: fullSystemPrompt },
    ...conversationTurns,
  ];

  // 5. Resolve the admin-selected model (falls back to the default list)
  const modelConfig = await getChatbotModel(db);

  // ─── Proxy to OpenRouter ─────────────────────────────────────────────
  try {
    const orResponse = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://bitsnotes.com',
        'X-Title': 'BitsNotes AI Study Assistant',
      },
      body: JSON.stringify({
        models: modelConfig.models,
        messages: upstreamMessages,
        temperature: 0.3,
        // Ask OpenRouter to include token usage in the response so we can
        // store per-request cost data for admin analytics.
        usage: { include: true },
      }),
    });

    if (!orResponse.ok) {
      const upstreamBody = await orResponse.text().catch(() => '');
      console.error('[chatbot/chat] OpenRouter error:', orResponse.status, upstreamBody);
      await markRequestError(db, requestId, {
        errorCode: 'upstream_http',
        httpStatus: orResponse.status,
        model: modelConfig.models[0] || null,
        latencyMs: Date.now() - startedAt,
        refund: reserved,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    const data = (await orResponse.json()) as Record<string, any>;

    if (data?.error) {
      console.error('[chatbot/chat] OpenRouter returned an error payload:', data.error);
      await markRequestError(db, requestId, {
        errorCode: 'upstream_error',
        httpStatus: 502,
        model: modelConfig.models[0] || null,
        latencyMs: Date.now() - startedAt,
        refund: reserved,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    let assistantContent = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const rawContent = typeof data.choices[0].message.content === 'string' ? data.choices[0].message.content : '';
      const cleaned = normalizeAssistantReply(rawContent);
      assistantContent = cleaned || rawContent.trim();
    }

    if (!assistantContent) {
      await markRequestError(db, requestId, {
        errorCode: 'empty_response',
        httpStatus: 502,
        model: modelConfig.models[0] || null,
        latencyMs: Date.now() - startedAt,
        refund: reserved,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    const usedModel =
      typeof data.model === 'string' && data.model.trim()
        ? data.model.trim()
        : modelConfig.models[0] || null;

    await markRequestSuccess(db, requestId, {
      model: usedModel,
      promptTokens: tokenCount(data?.usage?.prompt_tokens),
      completionTokens: tokenCount(data?.usage?.completion_tokens),
      latencyMs: Date.now() - startedAt,
    });

    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: assistantContent } }],
      _sources: relatedSources,
    }, 200);
  } catch (err) {
    console.error('[chatbot/chat] Proxy error:', err);
    await markRequestError(db, requestId, {
      errorCode: 'internal',
      httpStatus: 503,
      model: modelConfig.models[0] || null,
      latencyMs: Date.now() - startedAt,
      refund: reserved,
    });
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }
};
