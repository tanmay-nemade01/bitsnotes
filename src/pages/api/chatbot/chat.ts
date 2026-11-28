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
import {
  getHiddenLectureKeys,
  makeLectureKey,
  LectureVisibilityUnavailableError,
} from '../../../lib/lectureVisibility';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import {
  buildBaseSystemPrompt,
  buildCompanionBlock,
  buildCurrentLectureBlock,
  buildRelatedBlock,
  buildZeroSignalBlock,
  getCompanionSnippets,
  getCurrentLectureContext,
  getLastUserQuery,
  getRelatedSnippets,
  isZeroSignalQuery,
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

/**
 * Strip the longest exact suffix of `base` that reappears at the start of
 * `continuation`. Models occasionally repeat the tail of their previous
 * output when asked to continue; this keeps the stitched answer seamless.
 */
function stripLeadingOverlap(base: string, continuation: string): string {
  const maxCheck = Math.min(120, base.length, continuation.length);
  for (let len = maxCheck; len >= 8; len--) {
    if (base.slice(base.length - len) === continuation.slice(0, len)) {
      return continuation.slice(len);
    }
  }
  return continuation;
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

  // ─── Visibility gates (parallel reads; both must pass before any work) ──
  let hiddenLectures = new Set<string>();
  if (!isAdmin) {
    try {
      // Two independent reads — one D1 round-trip instead of two serial ones.
      const [lectureKeys, hiddenSubjects] = await Promise.all([
        getHiddenLectureKeys(db),
        subject ? getHiddenSubjectNames(db) : Promise.resolve(new Set<string>()),
      ]);
      hiddenLectures = lectureKeys;

      if (subject && hiddenSubjects.has(subject)) {
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
      if (excludeFolder && hiddenLectures.has(makeLectureKey(subject, excludeFolder))) {
        await logBlockedRequest(db, {
          requestId,
          userId: user.id,
          conversationId,
          errorCode: 'blocked_lecture',
          httpStatus: 404,
          usageDay,
        });
        return jsonResponse({ error: 'Lecture not found.' }, 404);
      }
    } catch (err) {
      if (err instanceof LectureVisibilityUnavailableError) {
        return jsonResponse({ error: 'Lecture visibility unavailable' }, 503);
      }
      if (err instanceof SubjectVisibilityUnavailableError) {
        return jsonResponse({ error: 'Subject visibility unavailable' }, 503);
      }
      throw err;
    }
  }

  // ─── Phase B: parallel tracks — D1 bookkeeping ∥ context retrieval ∥ model ──
  // These were previously sequential, stacking ~9 D1 round-trips plus a
  // retrieval chain before the model call even started. The tracks are
  // independent (retrieval only reads edge-cached notes and uses the
  // hidden sets resolved above), so they now overlap. Quota ordering,
  // refund semantics, and every error path inside the bookkeeping track
  // are unchanged. When the bookkeeping track blocks (duplicate, quota,
  // internal error), the in-flight retrieval reads are simply abandoned —
  // they are idempotent reads with no side effects.
  const bookkeepingPromise = (async (): Promise<{ blocked: Response | null; reserved: boolean }> => {
    // Create the request row BEFORE the model call — the audit record
    // exists even if the upstream call hangs or the worker dies. The
    // quota slot is reserved immediately afterwards.
    const insertResult = await insertRequestStart(db, {
      requestId,
      userId: user.id,
      conversationId,
      usageDay,
      createdAt: startedAt,
      reserved: false,
    });

    if (insertResult === 'duplicate') {
      return {
        blocked: jsonResponse({ error: 'This request was already submitted. Please try again.' }, 409),
        reserved: false,
      };
    }
    if (insertResult === 'error') {
      return {
        blocked: jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503),
        reserved: false,
      };
    }

    // ─── Atomic daily quota reservation (admins bypass) ────────────────
    let reserved = false;
    if (!isAdmin) {
      try {
        // Independent reads overlap; the reservation itself stays atomic
        // and strictly ordered after both.
        const [, limit] = await Promise.all([
          cleanupStalePendingRequests(db, user.id),
          getUserChatbotLimit(db, user.id),
        ]);
        reserved = await reserveChatbotUsage(db, user.id, limit, usageDay);
      } catch (err) {
        console.error('[chatbot/chat] Quota reservation failed:', err);
        await markRequestError(db, requestId, {
          errorCode: 'internal',
          httpStatus: 503,
          latencyMs: Date.now() - startedAt,
        });
        return {
          blocked: jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503),
          reserved: false,
        };
      }

      if (!reserved) {
        await markRequestError(db, requestId, {
          errorCode: 'quota_exceeded',
          httpStatus: 429,
          latencyMs: Date.now() - startedAt,
        });

        // Intentionally omit usage numbers: the fair-use threshold is internal.
        return {
          blocked: jsonResponse(
            {
              error: "You've reached today's fair-use limit. Please try again tomorrow.",
              limitReached: true,
            },
            429
          ),
          reserved: false,
        };
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
        return {
          blocked: jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503),
          reserved: false,
        };
      }
    }

    // ─── Store the question (content only, never the response) ────────
    const userTurns = (body.messages || []).filter(
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

    return { blocked: null, reserved };
  })();

  // Context retrieval track — pure reads (edge-cached lectures, R2
  // companion ranges); every failure is non-fatal and degrades to less
  // context rather than a failed request.
  const retrievalPromise = (async () => {
    // 1. Fetch current lecture section chunks (non-fatal)
    let lectureContext: CurrentLectureContext = {
      text: '',
      confidence: 0,
      hasHighConfidenceMatch: false,
      matchedSections: [],
      sectionTitles: [],
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
    // Raw retrieval counts (pre visibility-filter) feed the zero-signal gate.
    let lectureSnippetCount = 0;
    let companionSnippetCount = 0;
    try {
      const [lectureSnippets, companionSnippets] = await Promise.all([
        needRelated && subject && excludeFolder
          ? getRelatedSnippets({ subject, excludeFolder, query })
          : Promise.resolve([]),
        needCompanion && subject
          ? getCompanionSnippets({ subject, query })
          : Promise.resolve([]),
      ]);
      lectureSnippetCount = lectureSnippets.length;
      companionSnippetCount = companionSnippets.length;
      if (lectureSnippets.length > 0) {
        // Never let auxiliary retrieval surface content from hidden lectures.
        const visibleSnippets = lectureSnippets.filter(
          (s) => !hiddenLectures.has(makeLectureKey(s.subject, s.folderName)),
        );
        if (visibleSnippets.length > 0) {
          relatedBlock = buildRelatedBlock(visibleSnippets);
          relatedSources = visibleSnippets.map((s) => ({
            kind: 'lecture',
            title: s.title,
            folderName: s.folderName,
            slug: s.slug,
          }));
        }
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

    return {
      lectureContext,
      relatedBlock,
      companionBlock,
      relatedSources,
      lectureSnippetCount,
      companionSnippetCount,
      needRelated,
      needCompanion,
    };
  })();

  const [retrieval, bookkeeping, modelConfig] = await Promise.all([
    retrievalPromise,
    bookkeepingPromise,
    getChatbotModel(db),
  ]);
  if (bookkeeping.blocked) return bookkeeping.blocked;
  const reserved = bookkeeping.reserved;

  const {
    lectureContext,
    relatedBlock,
    companionBlock,
    relatedSources,
    lectureSnippetCount,
    companionSnippetCount,
    needRelated,
    needCompanion,
  } = retrieval;

  // 3. Assemble lean tiered context block server-side
  // Zero-signal cheap path: nothing in the subject matches the query, so
  // serve it from a minimal context (~1.5K tokens) instead of the full
  // lecture budget — off-topic spam cannot farm tokens. The model is
  // still called, so a genuinely unusual phrasing degrades gracefully.
  const relatedWasRetrieved = needRelated && Boolean(subject && excludeFolder);
  const companionWasRetrieved = needCompanion && Boolean(subject);
  const zeroSignal = isZeroSignalQuery({
    query,
    hasHighConfidenceMatch: lectureContext.hasHighConfidenceMatch,
    relatedRetrieved: relatedWasRetrieved,
    relatedCount: lectureSnippetCount,
    companionRetrieved: companionWasRetrieved,
    companionCount: companionSnippetCount,
  });

  const baseSystemPrompt = buildBaseSystemPrompt(subject);
  const currentLectureBlock = zeroSignal
    ? buildZeroSignalBlock(subject, excludeFolder, lectureContext.sectionTitles)
    : buildCurrentLectureBlock(subject, excludeFolder, lectureContext.text);

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

  // ─── Proxy to OpenRouter ─────────────────────────────────────────────
  // Completion ceiling: generous enough that real answers (worked quizzes,
  // derivations, code walkthroughs — up to ~4500 words) finish naturally.
  // No user should ever see an answer cut mid-sentence: if a length wall
  // is hit (ours or the model's own output limit), the answer is continued
  // seamlessly before being served.
  const MAX_COMPLETION_TOKENS = 6000;
  const MAX_CONTINUATIONS = 2;

  const openrouterHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://bitsnotes.com',
    'X-Title': 'BitsNotes AI Study Assistant',
  };
  const openrouterBody = (msgs: Array<{ role: string; content: string }>) =>
    JSON.stringify({
      models: modelConfig.models,
      messages: msgs,
      // 0.6 keeps grounding solid while letting the tutor persona sound
      // like a person, not a spec sheet (0.3 read as stiff and clipped).
      temperature: 0.6,
      max_tokens: MAX_COMPLETION_TOKENS,
      // Include token usage so per-request cost data lands in admin analytics.
      usage: { include: true },
    });

  try {
    const orResponse = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: openrouterHeaders,
      body: openrouterBody(upstreamMessages),
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

    const firstChoice = data?.choices?.[0];
    let rawContent = firstChoice && typeof firstChoice.message?.content === 'string'
      ? firstChoice.message.content
      : '';
    let finishReason: string = typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : '';
    const usedModel =
      typeof data.model === 'string' && data.model.trim()
        ? data.model.trim()
        : modelConfig.models[0] || null;
    let promptTokens = tokenCount(data?.usage?.prompt_tokens) || 0;
    let completionTokens = tokenCount(data?.usage?.completion_tokens) || 0;

    // Auto-continuation: a length-clipped answer looks unprofessional, so
    // finish it before serving. Bounded so an abuser engineering long
    // outputs still gets a per-slot ceiling (3 segments max); the combined
    // token totals land in admin analytics either way.
    for (let i = 0; finishReason === 'length' && rawContent.trim() && i < MAX_CONTINUATIONS; i++) {
      try {
        const contResponse = await fetch(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers: openrouterHeaders,
          body: openrouterBody([
            ...upstreamMessages,
            { role: 'assistant', content: rawContent },
            {
              role: 'user',
              content:
                'Your previous message was cut off mid-output by a length limit. Continue the answer seamlessly from exactly where it stopped — do not repeat any text, do not apologize, do not start over. Finish the thought, then stop.',
            },
          ]),
        });
        if (!contResponse.ok) break;
        const contData = (await contResponse.json()) as Record<string, any>;
        if (contData?.error) break;

        promptTokens += tokenCount(contData?.usage?.prompt_tokens) || 0;
        completionTokens += tokenCount(contData?.usage?.completion_tokens) || 0;

        const piece =
          contData?.choices?.[0]?.message &&
          typeof contData.choices[0].message.content === 'string'
            ? contData.choices[0].message.content
            : '';
        if (!piece.trim()) break;

        rawContent += stripLeadingOverlap(rawContent, piece);
        finishReason =
          typeof contData?.choices?.[0]?.finish_reason === 'string'
            ? contData.choices[0].finish_reason
            : '';
      } catch (err) {
        console.error('[chatbot/chat] Continuation failed (serving what we have):', err);
        break;
      }
    }

    const cleaned = normalizeAssistantReply(rawContent);
    const assistantContent = cleaned || rawContent.trim();

    if (!assistantContent) {
      await markRequestError(db, requestId, {
        errorCode: 'empty_response',
        httpStatus: 502,
        model: usedModel,
        latencyMs: Date.now() - startedAt,
        refund: reserved,
      });
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    await markRequestSuccess(db, requestId, {
      model: usedModel,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
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
