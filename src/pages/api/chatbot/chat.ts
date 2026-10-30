/**
 * POST /api/chatbot/chat
 * Server-side proxy for BitsNotes AI chatbot mode.
 * - Requires authenticated user (session cookie)
 * - Enforces monthly message limit per user via D1 chatbot_usage table (admins exempt)
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
import { getChatbotUsage, incrementChatbotUsage } from '../../../lib/chatbotUsage';

export const prerender = false;

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_CHAT_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
];

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = (locals as any).user;
  const isAdmin = Boolean((locals as any).isAdmin);
  if (!user) {
    return jsonResponse({ error: 'Authentication required. Please sign in to use BitsNotes AI.' }, 401);
  }
  if (!isAdmin && user.accessExpiresAt && Date.now() > user.accessExpiresAt) {
    return jsonResponse({ error: 'Your access has expired. Please contact an administrator or support to renew access.' }, 403);
  }

  const env = await getEnv();
  if (!validateOrigin(request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }
  const db = env.DB;
  const openrouterKey = env.OPENROUTER_API_KEY;

  if (!db || !openrouterKey) {
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  // ─── Burst rate limiting (10 req/min) ────────────────────────────────
  const rateLimiter = env.CHATBOT_RATE_LIMITER;
  if (rateLimiter) {
    try {
      const rl = await rateLimiter.limit({ key: user.id });
      if (!rl.success) {
        return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 429);
      }
    } catch {
      // Rate limiter unavailable — proceed without burst protection
    }
  }

  // ─── Monthly limit check (admins bypass) ─────────────────────────────
  let usageInfo;
  try {
    usageInfo = await getChatbotUsage(db, user.id, isAdmin);
  } catch (err) {
    console.error('[chatbot/chat] Failed to read usage:', err);
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }

  if (!isAdmin && usageInfo.remaining !== null && usageInfo.remaining <= 0) {
    return jsonResponse({
      error: `You've reached your monthly limit of ${usageInfo.limit} messages. Your limit will reset on the 1st of next month!`,
      limitReached: true,
      used: usageInfo.used,
      limit: usageInfo.limit,
      remaining: 0,
      unlimited: false,
    }, 429);
  }

  // ─── Parse request body ──────────────────────────────────────────────
  let body: {
    messages?: Array<{ role?: string; content?: unknown }>;
    subject?: string;
    lectureFolder?: string;
    query?: string;
    includeTextbook?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'Messages array is required.' }, 400);
  }

  // ─── Progressive retrieval: current lecture + intent-gated auxiliary sources ────
  let subject = (body.subject || '').replace(/["\r\n<>]/g, '').trim().slice(0, 120);
  let excludeFolder = (body.lectureFolder || '').replace(/["\r\n<>]/g, '').trim().slice(0, 160);
  let query = (body.query || '').trim().slice(0, 1000);
  const includeTextbook = body.includeTextbook !== false;

  const systemMsgForParse = body.messages.find((m) => m?.role === 'system');
  if ((!subject || !excludeFolder) && systemMsgForParse && typeof systemMsgForParse.content === 'string') {
    const parsed = parseSubjectFromSystemPrompt(systemMsgForParse.content);
    if (!subject) subject = parsed.subject;
    if (!excludeFolder) excludeFolder = parsed.lectureFolder;
  }
  if (!query) query = getLastUserQuery(body.messages);

  if (!isAdmin && subject) {
    try {
      const hiddenSubjects = await getHiddenSubjectNames(db);
      if (hiddenSubjects.has(subject)) {
        return jsonResponse({ error: 'Subject not found.' }, 404);
      }
    } catch (err) {
      if (err instanceof SubjectVisibilityUnavailableError) {
        return jsonResponse({ error: 'Subject visibility unavailable' }, 503);
      }
      throw err;
    }
  }

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
        models: OPENROUTER_CHAT_MODELS,
        messages: upstreamMessages,
        temperature: 0.3,
      }),
    });

    if (!orResponse.ok) {
      console.error('[chatbot/chat] OpenRouter error:', orResponse.status, await orResponse.text().catch(() => ''));
      return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
    }

    const data = (await orResponse.json()) as Record<string, any>;

    let assistantContent = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const rawContent = typeof data.choices[0].message.content === 'string' ? data.choices[0].message.content : '';
      const cleaned = normalizeAssistantReply(rawContent);
      assistantContent = cleaned || rawContent.trim();
    }

    // ─── Increment usage counter on success ──────────────────────────
    let finalUsage = usageInfo;
    try {
      finalUsage = await incrementChatbotUsage(db, user.id, isAdmin);
    } catch (err) {
      console.error('[chatbot/chat] Failed to increment usage:', err);
    }

    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: assistantContent } }],
      _usage: finalUsage,
      _sources: relatedSources,
    }, 200);
  } catch (err) {
    console.error('[chatbot/chat] Proxy error:', err);
    return jsonResponse({ error: 'Chatbot is under heavy use, please try again later.' }, 503);
  }
};
