/**
 * Lean cross-lecture retrieval for the BitsNotes AI chatbot.
 *
 * Goal: answer complex doubts that span multiple lectures in the same subject
 * with minimal performance impact — no vector DB, no embeddings, no extra
 * client round-trips.
 *
 * Strategy:
 * - Reuse the already edge-cached manifest (`getManifest`) as the candidate
 *   index. No extra R2 read for `search-index.json`.
 * - Score candidates with the existing keyword engine (`searchEngine.ts`).
 * - Fetch at most 2 related lectures via `getLectureContent` (itself
 *   edge-cached), strip HTML server-side, truncate to a hard char budget.
 * - All failures are non-fatal: return [] and let the caller fall back to
 *   single-lecture context.
 */

import { getLectureContent, getManifest } from '../utils/notesLoader';
import { getEnv } from './getEnv';
import {
  executeSearch,
  prepareSearchIndex,
  tokenizeQuery,
  type RawSearchItem,
} from '../utils/searchEngine';

export const RELATED_LIMIT = 2;
export const MAX_CHARS_PER_LECTURE = 2000;
export const TOTAL_BUDGET_CHARS = 4500;
export const MIN_QUERY_LENGTH = 2;
export const MAX_CURRENT_LECTURE_CHARS = 4000;

// ─── Textbook companion (per-subject supplementary chapters) ─────────────
export const COMPANION_LIMIT = 1;
export const MAX_CHARS_PER_COMPANION = 1200;
export const COMPANION_PREVIEW_CHARS = 1200;

export interface RelatedSource {
  subject: string;
  folderName: string;
  title: string;
  slug: string;
}

export interface RelatedSnippet extends RelatedSource {
  snippet: string;
}

/** Minimal shape we need from the manifest for scoring. */
interface ManifestLectureLike {
  folderName: string;
  fileName?: string;
  displayTitle?: string;
  topicTitle?: string;
  slug?: string;
  shortDescription?: string;
  topics?: string[];
  metadata?: {
    summary?: string;
    keyConcepts?: string[];
    sections?: Array<{ title?: string; description?: string }>;
    examRevisionNotes?: Array<{ topic?: string; mustKnow?: string } | string>;
    topics?: string[];
    shortDescription?: string;
  } | null;
}

/**
 * Strip HTML to plain text for LLM context. Lightweight, no dependencies.
 * Mirrors `cleanHtmlText` in search-index.json.ts.
 */
export function cleanHtmlToText(html: string): string {
  if (!html) return '';
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'");
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build the searchable text for a candidate lecture from catalog fields +
 * embedded metadata. Deliberately compact (titles, concepts, section
 * headings) — not full body — so scoring stays sub-millisecond.
 */
export function buildCandidateText(lecture: ManifestLectureLike): string {
  const parts: string[] = [];
  if (lecture.topicTitle) parts.push(lecture.topicTitle);
  if (lecture.displayTitle) parts.push(lecture.displayTitle);
  if (lecture.shortDescription) parts.push(lecture.shortDescription);
  if (Array.isArray(lecture.topics)) parts.push(lecture.topics.join(' '));

  const meta = lecture.metadata;
  if (meta) {
    if (meta.shortDescription) parts.push(meta.shortDescription);
    if (Array.isArray(meta.topics)) parts.push(meta.topics.join(' '));
    if (Array.isArray(meta.keyConcepts)) parts.push(meta.keyConcepts.join(' '));
    if (typeof meta.summary === 'string' && meta.summary.length > 0) {
      // Summary can be long — keep a prefix for recall without bloating.
      parts.push(meta.summary.slice(0, 500));
    }
    if (Array.isArray(meta.sections)) {
      for (const sec of meta.sections.slice(0, 12)) {
        if (sec?.title) parts.push(sec.title);
        if (sec?.description) parts.push(sec.description.slice(0, 200));
      }
    }
    if (Array.isArray(meta.examRevisionNotes)) {
      for (const note of meta.examRevisionNotes.slice(0, 8)) {
        if (typeof note === 'string') parts.push(note.slice(0, 200));
        else if (note && typeof note === 'object') {
          if (note.topic) parts.push(note.topic);
          if (note.mustKnow) parts.push(note.mustKnow.slice(0, 200));
        }
      }
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Rank candidate lectures for a query, excluding the current lecture.
 * Pure function — easy to unit test, no I/O.
 */
export function rankCandidates(
  lectures: ManifestLectureLike[],
  query: string,
  excludeFolder: string,
  limit: number = RELATED_LIMIT
): ManifestLectureLike[] {
  const q = (query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  const { meaningfulTerms, isPureStopWords, allTerms } = tokenizeQuery(q);
  // Pure stop-word queries carry no retrieval signal.
  if (isPureStopWords) return [];
  if (meaningfulTerms.length === 0 && allTerms.length === 0) return [];

  const items: RawSearchItem[] = lectures
    .filter((l) => l.folderName !== excludeFolder)
    .map((l) => ({
      type: 'note',
      title: l.displayTitle || l.topicTitle || l.folderName,
      subject: '',
      folderName: l.folderName,
      slug: l.slug || l.folderName,
      topicTitle: l.topicTitle || '',
      text: buildCandidateText(l),
    }));

  if (items.length === 0) return [];

  const prepared = prepareSearchIndex(items);
  const res = executeSearch(prepared, q, limit + 1);
  if (res.status !== 'ready' || res.matches.length === 0) return [];

  const byFolder = new Map(lectures.map((l) => [l.folderName, l]));
  const ranked: ManifestLectureLike[] = [];
  for (const m of res.matches) {
    const orig = m.folderName ? byFolder.get(m.folderName) : undefined;
    if (orig && orig.folderName !== excludeFolder) ranked.push(orig);
    if (ranked.length >= limit) break;
  }
  return ranked;
}

/**
 * Extract a query-centered plain-text window from a full lecture text.
 * Centers on the first meaningful-term hit so the LLM gets the most
 * relevant passage within the hard char budget.
 */
export function extractSnippetWindow(
  fullText: string,
  query: string,
  maxChars: number = MAX_CHARS_PER_LECTURE
): string {
  const clean = (fullText || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;

  const { cleanQuery, meaningfulTerms } = tokenizeQuery(query || '');
  const lower = clean.toLowerCase();

  let hitIdx = -1;
  let hitLen = 0;

  if (cleanQuery.length >= MIN_QUERY_LENGTH) {
    const phraseIdx = lower.indexOf(cleanQuery);
    if (phraseIdx !== -1) {
      hitIdx = phraseIdx;
      hitLen = cleanQuery.length;
    }
  }
  if (hitIdx === -1) {
    for (const term of meaningfulTerms) {
      if (term.length < 2) continue;
      const idx = lower.indexOf(term);
      if (idx !== -1 && (hitIdx === -1 || idx < hitIdx)) {
        hitIdx = idx;
        hitLen = term.length;
      }
    }
  }
  if (hitIdx === -1) {
    return clean.slice(0, maxChars).trim() + '…';
  }

  // Center the window on the hit, with more context after than before.
  const before = Math.floor(maxChars * 0.3);
  const start = Math.max(0, hitIdx - before);
  const end = Math.min(clean.length, start + maxChars);
  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < clean.length) snippet = snippet + '…';
  void hitLen;
  return snippet;
}

export interface CurrentLectureContext {
  text: string;
  confidence: number;
  hasHighConfidenceMatch: boolean;
  matchedSections: string[];
  toString(): string;
}

/**
 * Score an individual lecture section against the user query.
 * Uses exact phrase matching, meaningful term hits, and coverage bonuses.
 */
export function scoreSectionAgainstQuery(
  section: { title?: string; description?: string } | undefined,
  query: string
): number {
  if (!section) return 0;
  const q = (query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) return 0;

  const { cleanQuery, meaningfulTerms, allTerms, isPureStopWords } = tokenizeQuery(q);
  if (isPureStopWords) return 0;

  const termsToUse = meaningfulTerms.length > 0 ? meaningfulTerms : allTerms;
  if (termsToUse.length === 0) return 0;

  const titleLower = (section.title || '').toLowerCase();
  const descLower = (section.description || '').toLowerCase();

  let score = 0;

  // Exact phrase match
  if (cleanQuery.length >= MIN_QUERY_LENGTH) {
    if (titleLower.includes(cleanQuery)) {
      score += 60;
    } else if (descLower.includes(cleanQuery)) {
      score += 35;
    }
  }

  // Term matches
  let matchedTermsCount = 0;
  for (const term of termsToUse) {
    if (term.length < 2) continue;
    let matched = false;
    if (titleLower.includes(term)) {
      score += 25;
      matched = true;
    }
    if (descLower.includes(term)) {
      score += 12;
      matched = true;
    }
    if (matched) {
      matchedTermsCount++;
    }
  }

  // Coverage bonus if all terms matched
  if (matchedTermsCount === termsToUse.length && termsToUse.length > 0) {
    score += 20;
  }

  return score;
}

/**
 * Pure extraction helper: parses lecture title, overview/concepts, full section
 * outline, relevant section details, examRevisionNotes (formulas & must-know),
 * and a query-centered HTML text window, capped at MAX_CURRENT_LECTURE_CHARS.
 */
export function extractCurrentLectureChunks(opts: {
  metadata?: Record<string, any> | null;
  htmlContent?: string;
  query: string;
}): CurrentLectureContext {
  const { metadata, htmlContent, query } = opts;
  const q = (query || '').trim();

  // 1. High-level title, summary, and key concepts
  const overviewParts: string[] = [];
  if (metadata?.title && typeof metadata.title === 'string' && metadata.title.trim()) {
    overviewParts.push(`Lecture Title: ${metadata.title.trim()}`);
  }
  if (metadata?.summary && typeof metadata.summary === 'string' && metadata.summary.trim()) {
    overviewParts.push(`Overview: ${metadata.summary.slice(0, 400).trim()}`);
  }
  if (Array.isArray(metadata?.keyConcepts) && metadata.keyConcepts.length > 0) {
    const concepts = metadata.keyConcepts
      .filter((c: unknown): c is string => typeof c === 'string' && Boolean(c.trim()))
      .slice(0, 8)
      .join(', ');
    if (concepts) {
      overviewParts.push(`Key Concepts: ${concepts}`);
    }
  }
  const overviewBlock = overviewParts.join('\n');

  // 2. Score sections against query
  const rawSections: Array<{ title?: string; description?: string }> = Array.isArray(metadata?.sections)
    ? metadata.sections
    : [];

  const scoredSections = rawSections.map((sec) => ({
    title: sec?.title || '',
    description: sec?.description || '',
    score: scoreSectionAgainstQuery(sec, q),
  }));

  scoredSections.sort((a, b) => b.score - a.score);
  const topScore = scoredSections.length > 0 ? scoredSections[0].score : 0;
  const positivelyMatched = scoredSections.filter((s) => s.score > 0);
  const relevantSections = positivelyMatched.length > 0
    ? positivelyMatched.slice(0, 3)
    : scoredSections.slice(0, 3);

  // Also build a compact full-lecture section outline so whole-lecture queries see all topics
  const outlineLines = rawSections
    .filter((s) => s?.title)
    .slice(0, 12)
    .map((s) => `- ${s.title}${s.description ? ': ' + s.description.slice(0, 140).trim() : ''}`);
  const outlineBlock = outlineLines.length > 0
    ? `### Lecture Outline:\n${outlineLines.join('\n')}`
    : '';

  // 3. Extract examRevisionNotes (formulas, definitions, must-know takeaways)
  const rawRevision: Array<any> = Array.isArray(metadata?.examRevisionNotes)
    ? metadata.examRevisionNotes
    : [];
  const revisionLines: string[] = [];
  for (const item of rawRevision.slice(0, 8)) {
    if (typeof item === 'string' && item.trim()) {
      revisionLines.push(`- ${item.slice(0, 220).trim()}`);
    } else if (item && typeof item === 'object') {
      const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
      const mustKnow = typeof item.mustKnow === 'string' ? item.mustKnow.slice(0, 220).trim() : '';
      const formula = typeof item.keyFormula === 'string' && item.keyFormula.trim()
        ? ` | Formula: ${item.keyFormula.trim()}`
        : '';
      if (topic || mustKnow) {
        revisionLines.push(`- **${topic || 'Key Point'}**: ${mustKnow}${formula}`);
      }
    }
  }
  const revisionBlock = revisionLines.length > 0
    ? `### Core Takeaways & Formulas:\n${revisionLines.join('\n')}`
    : '';

  // 4. Extract text window from HTML body if available
  const fullText = cleanHtmlToText(htmlContent || '');
  let textWindow = '';
  let textHit = false;

  if (fullText && q.length >= MIN_QUERY_LENGTH) {
    const { cleanQuery, meaningfulTerms, isPureStopWords } = tokenizeQuery(q);
    if (!isPureStopWords) {
      const lowerFull = fullText.toLowerCase();
      textHit =
        (cleanQuery.length >= MIN_QUERY_LENGTH && lowerFull.includes(cleanQuery)) ||
        meaningfulTerms.some((t) => t.length >= 2 && lowerFull.includes(t));
      textWindow = extractSnippetWindow(fullText, q, 1600);
    }
  }

  // 5. Assemble context blocks in priority order
  const blocks: string[] = [];
  if (overviewBlock) {
    blocks.push(overviewBlock);
  }
  if (relevantSections.length > 0) {
    const sectionTexts = relevantSections.map(
      (s) => `### Section: ${s.title}\n${s.description}`
    );
    blocks.push(sectionTexts.join('\n\n'));
  }
  if (revisionBlock) {
    blocks.push(revisionBlock);
  }
  if (outlineBlock && rawSections.length > relevantSections.length) {
    blocks.push(outlineBlock);
  }
  if (textWindow) {
    blocks.push(`### Relevant Excerpt from Lecture Notes:\n${textWindow}`);
  } else if (!relevantSections.length && fullText) {
    blocks.push(`### Lecture Notes Excerpt:\n${fullText.slice(0, 1600)}`);
  }

  // 6. Enforce hard cap at MAX_CURRENT_LECTURE_CHARS (4,000 chars)
  let text = blocks.join('\n\n').trim();
  if (text.length > MAX_CURRENT_LECTURE_CHARS) {
    text = text.slice(0, MAX_CURRENT_LECTURE_CHARS - 1).trim() + '…';
  }

  // 7. Match confidence
  const hasHighConfidenceMatch =
    topScore >= 20 ||
    (textHit && topScore > 0) ||
    (rawSections.length === 0 && textHit);

  const confidence = Math.min(
    1,
    Math.max(0, topScore > 0 ? topScore / 60 : textHit ? 0.6 : 0)
  );

  return {
    text,
    confidence,
    hasHighConfidenceMatch,
    matchedSections: positivelyMatched.map((s) => s.title),
    toString() {
      return this.text;
    },
  };
}

/**
 * Fetch and extract the progressive section-level context for the current lecture.
 * Cached via getLectureContent; non-fatal on failure.
 */
export async function getCurrentLectureContext(
  subjectOrOpts: string | { subject: string; lectureFolder: string; query: string },
  lectureFolderArg?: string,
  queryArg?: string
): Promise<CurrentLectureContext> {
  let subject = '';
  let lectureFolder = '';
  let query = '';

  if (typeof subjectOrOpts === 'object' && subjectOrOpts !== null) {
    subject = (subjectOrOpts.subject || '').trim();
    lectureFolder = (subjectOrOpts.lectureFolder || '').trim();
    query = (subjectOrOpts.query || '').trim();
  } else {
    subject = (subjectOrOpts || '').trim();
    lectureFolder = (lectureFolderArg || '').trim();
    query = (queryArg || '').trim();
  }

  const emptyResult: CurrentLectureContext = {
    text: '',
    confidence: 0,
    hasHighConfidenceMatch: false,
    matchedSections: [],
    toString() {
      return this.text;
    },
  };

  if (!subject || !lectureFolder) return emptyResult;

  try {
    const content = await getLectureContent(subject, lectureFolder);
    if (!content) return emptyResult;

    return extractCurrentLectureChunks({
      metadata: content.metadata,
      htmlContent: content.htmlContent,
      query,
    });
  } catch (err) {
    console.error('[chatbotRetrieval] Failed to load current lecture context (non-fatal):', err);
    return emptyResult;
  }
}

// ─── Intent Gating for Auxiliary Sources ────────────────────────────────

export const COMPARATIVE_INTENT_REGEX =
  /\b(differ|difference|compare|versus|vs|other lecture|earlier|previous|next|relation between)\b/i;

export const TEXTBOOK_INTENT_REGEX =
  /\b(textbook|book|proof|prove|derivation|derive|deep dive|in-depth|rigorous|formal|mathematical formulation|theory)\b/i;

export function hasCrossLectureIntent(query: string): boolean {
  return COMPARATIVE_INTENT_REGEX.test(query || '');
}

export function hasTextbookIntent(query: string): boolean {
  return TEXTBOOK_INTENT_REGEX.test(query || '');
}

/**
 * Determines whether related lectures should be fetched.
 * Gated by comparative query intent or low current-lecture match confidence.
 */
export function shouldRetrieveRelated(opts: {
  query: string;
  hasHighConfidenceMatch?: boolean;
}): boolean {
  const { query, hasHighConfidenceMatch = false } = opts;
  const q = (query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) return false;
  const { isPureStopWords } = tokenizeQuery(q);
  if (isPureStopWords) return false;

  // Comparative/cross-topic query intent always triggers related retrieval
  if (hasCrossLectureIntent(q)) return true;

  // If current lecture already has high confidence direct match, skip related lectures
  if (hasHighConfidenceMatch) return false;

  // Fallback to related retrieval when current lecture match is low-confidence or sparse
  return true;
}

/**
 * Determines whether companion textbook should be fetched.
 * Gated by user preference, textbook intent, or sparse lecture content.
 */
export function shouldRetrieveCompanion(opts: {
  query: string;
  includeTextbook?: boolean;
  hasHighConfidenceMatch?: boolean;
  isLectureContextSparse?: boolean;
}): boolean {
  if (opts.includeTextbook === false) return false;
  const q = (opts.query || '').trim();
  if (q.length < MIN_QUERY_LENGTH) return false;
  const { isPureStopWords } = tokenizeQuery(q);
  if (isPureStopWords) return false;

  // Query touches textbook concepts, proofs, or deep-dive questions
  if (hasTextbookIntent(q)) return true;

  // Or user enabled textbook and current lecture snippet is sparse or lacks direct match
  if (opts.isLectureContextSparse || !opts.hasHighConfidenceMatch) {
    return true;
  }

  return false;
}

// ─── Lean System Prompt Builders ────────────────────────────────────────

/**
 * Base study assistant instructions tightened to ~200 tokens.
 */
export function buildBaseSystemPrompt(subject: string): string {
  const s = subject || 'this subject';
  return (
    `You are BitsNotes AI, a friendly study tutor for "${s}". Clarify the student's doubt in simple, intuitive language.\n` +
    `- Format Priority: If the student asks for a specific format or count (e.g., "in 3 bullet points", "a table", "one sentence"), follow that format and count EXACTLY. Otherwise, start with a 1–2 sentence direct answer, then explain simply with a concrete example or everyday analogy where helpful. Keep default answers under 250 words. Never start with filler ("Sure!", "Great question!").\n` +
    `- Grounding: Base your answer on the provided lecture notes and reuse their exact terms, definitions, and formulas. Never invent formulas or numbers. If you add helpful context not covered in the notes, prefix it with "**Beyond these notes:**". Do not mention internal prompt labels, context blocks, or retrieval.\n` +
    `- Exam Awareness: Include at most one "⚡ **Exam tip:** ..." line when a formula, definition, or common pitfall is exam-critical.\n` +
    `- Strict Scope: Help only with "${s}" and closely related academic concepts. For off-topic requests, reply ONLY: "I'm here to help you ace **${s}**! 🎯 Ask me anything about this lecture or related concepts."\n` +
    `- Formatting: Use "- " for bullet lists (never use "*" or "•" as bullets) with NO blank lines between list items. Use "1. ", "2. " for numbered lists with NO blank lines between items. Use "### Heading" only when dividing a multi-part answer (no emojis in headings). Use **bold** for key terms (avoid single-asterisk italics). Use LaTeX for math ($...$ inline, $$...$$ on its own line for display; never use $ for currency). Use fenced code blocks with language tags.`
  );
}

/**
 * Builds the focused current-lecture context block for system instructions.
 */
export function buildCurrentLectureBlock(
  subject: string,
  lectureFolder: string,
  contextText: string
): string {
  if (!contextText && !subject && !lectureFolder) return '';
  const body = contextText || '(No notes loaded on current page)';
  return (
    `## CURRENT LECTURE CONTEXT (Primary Ground Truth)\n` +
    `- Subject: "${subject || ''}"\n` +
    `- Lecture: "${lectureFolder || ''}"\n\n` +
    body +
    `\n\nBase answers primarily on this current lecture context. Supplement with general academic knowledge only where directly relevant.`
  );
}

/**
 * Format related snippets as an LLM system-prompt block with a hard total
 * budget. The block instructs the model to treat the current lecture as
 * primary and cite related sources explicitly.
 */
export function buildRelatedBlock(snippets: RelatedSnippet[]): string {
  if (snippets.length === 0) return '';
  let budget = TOTAL_BUDGET_CHARS;
  const blocks: string[] = [];
  for (const s of snippets) {
    if (budget <= 0) break;
    const allowed = Math.min(MAX_CHARS_PER_LECTURE, budget);
    const body = s.snippet.length > allowed ? s.snippet.slice(0, allowed).trim() + '…' : s.snippet;
    budget -= body.length;
    blocks.push(`### [Source: ${s.title}]\n${body}`);
  }
  if (blocks.length === 0) return '';
  return (
    `\n\n## RELATED LECTURES (supplementary — same subject, different lectures)\n` +
    `The current lecture above is the PRIMARY ground truth. Use these excerpts ONLY when the current lecture doesn't fully answer the question or when cross-lecture context genuinely helps. When you use them, cite inline like [Source: <title>]. Never invent lecture titles.\n` +
    blocks.join('\n\n')
  );
}

/** Parse `- Subject: "X"` / `- Lecture: "Y"` from a client-built system prompt (back-compat fallback). */
export function parseSubjectFromSystemPrompt(systemContent: string): { subject: string; lectureFolder: string } {
  let subject = '';
  let lectureFolder = '';
  if (!systemContent) return { subject, lectureFolder };
  const subMatch = systemContent.match(/-\s*Subject:\s*"([^"]+)"/);
  if (subMatch) subject = subMatch[1];
  const lecMatch = systemContent.match(/-\s*Lecture:\s*"([^"]+)"/);
  if (lecMatch) lectureFolder = lecMatch[1];
  return { subject, lectureFolder };
}

export function getLastUserQuery(messages: Array<{ role?: string; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.trim().slice(0, 1000);
    }
  }
  return '';
}

function toManifestLectures(subjectEntry: { lectures?: ManifestLectureLike[] } | undefined): ManifestLectureLike[] {
  if (!subjectEntry || !Array.isArray(subjectEntry.lectures)) return [];
  return subjectEntry.lectures;
}

/**
 * Main entry: find up to RELATED_LIMIT related lecture snippets for a query.
 * Never throws — returns [] on any failure so chat degrades to
 * single-lecture context.
 */
export async function getRelatedSnippets(opts: {
  subject: string;
  excludeFolder: string;
  query: string;
  limit?: number;
}): Promise<RelatedSnippet[]> {
  const { subject, excludeFolder, query } = opts;
  const limit = Math.min(opts.limit ?? RELATED_LIMIT, RELATED_LIMIT);
  try {
    const q = (query || '').trim();
    if (!subject || !q || q.length < MIN_QUERY_LENGTH) return [];
    const { isPureStopWords } = tokenizeQuery(q);
    if (isPureStopWords) return [];

    const manifest = await getManifest();
    const subjectEntry = manifest.subjects?.find((s) => s.name === subject);
    if (!subjectEntry) return [];

    const lectures = toManifestLectures(subjectEntry as unknown as { lectures?: ManifestLectureLike[] });
    if (lectures.length <= 1) return [];

    const ranked = rankCandidates(lectures, q, excludeFolder, limit);
    if (ranked.length === 0) return [];

    // Parallel fetch — each is edge-cached; cap concurrency by limit (2).
    const results = await Promise.all(
      ranked.map(async (lec): Promise<RelatedSnippet | null> => {
        try {
          const content = await getLectureContent(subject, lec.folderName);
          if (!content?.htmlContent) return null;
          const fullText = cleanHtmlToText(content.htmlContent);
          if (fullText.length < 100) return null;
          const snippet = extractSnippetWindow(fullText, q, MAX_CHARS_PER_LECTURE);
          if (!snippet) return null;
          const title =
            (lec as { displayTitle?: string }).displayTitle ||
            (lec as { topicTitle?: string }).topicTitle ||
            lec.folderName;
          return {
            subject,
            folderName: lec.folderName,
            title,
            slug: (lec as { slug?: string }).slug || lec.folderName,
            snippet,
          };
        } catch {
          return null;
        }
      })
    );

    return results.filter((r): r is RelatedSnippet => r !== null).slice(0, limit);
  } catch (err) {
    console.error('[chatbotRetrieval] Non-fatal retrieval failure:', err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Textbook companion retrieval (per-subject supplementary chapters).
//
// Same lean philosophy as cross-lecture retrieval: no vector DB, no
// embeddings. A per-subject `index.json` (chapter titles + preview text,
// built by scripts/upload-companion.mjs) is ranked with the existing keyword
// engine, then at most 1 full chapter file is fetched from R2 and a
// query-centered window is extracted. All failures are non-fatal.
// R2 layout (NOTES_BUCKET):
//   companion/<Subject Name>/index.json   (chapter titles + previews + bundle byte offsets)
//   companion/<Subject Name>/bundle.json  (concatenated full chapter texts; read via R2 range GET)
// ═══════════════════════════════════════════════════════════════════════════

export interface CompanionChapter {
  id: string;
  title: string;
  book: string;
  preview: string;
  /** Byte range of the full chapter inside the per-subject bundle object. */
  offset?: number;
  length?: number;
}

export interface CompanionSnippet {
  subject: string;
  chapterId: string;
  title: string;
  book: string;
  snippet: string;
}

const COMPANION_INDEX_TTL_MS = 60000;
const companionIndexCache = new Map<string, { data: CompanionChapter[]; time: number }>();

/**
 * Derive a human-readable chapter title from a companion txt filename.
 * e.g. "T1_Ch01_Boolean_Retrieval" -> "Boolean Retrieval",
 *      "R1_AppA_Porter_Algorithm"  -> "AppA Porter Algorithm".
 * Pure function — must stay in sync with scripts/upload-companion.mjs.
 */
export function deriveChapterTitle(fileName: string): string {
  let t = (fileName || '').replace(/\.txt$/i, '').trim();
  // Strip leading source-book tag: T1_, R12_, T1 _ , etc.
  t = t.replace(/^[TR]\d+[-_\s]+/i, '');
  // Strip leading chapter/section number tag: Ch01_, Chapter_10_, Lecture_3_, LN-1-, Chapter 1, etc.
  t = t.replace(/^(Ch|Chapter|Lecture|LN)[-_\s]*\d+[-_\s]*/i, '');
  t = t.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fileName;
}

/** Collapse plain textbook text to single-spaced (txt files, not HTML). */
export function cleanPlainText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Rank companion chapters for a query using preview text.
 * Pure function — easy to unit test, no I/O.
 */
export function rankCompanionCandidates(
  chapters: CompanionChapter[],
  query: string,
  limit: number = COMPANION_LIMIT
): CompanionChapter[] {
  const q = (query || '').trim();
  if (q.length < MIN_QUERY_LENGTH || chapters.length === 0) return [];
  const { meaningfulTerms, isPureStopWords, allTerms } = tokenizeQuery(q);
  if (isPureStopWords) return [];
  if (meaningfulTerms.length === 0 && allTerms.length === 0) return [];

  const items: RawSearchItem[] = chapters.map((c) => ({
    type: 'note',
    title: c.title,
    subject: '',
    folderName: c.id,
    slug: c.id,
    topicTitle: c.title,
    text: `${c.title} ${c.preview || ''}`,
  }));

  const prepared = prepareSearchIndex(items);
  const res = executeSearch(prepared, q, limit + 1);
  if (res.status !== 'ready' || res.matches.length === 0) return [];

  const byId = new Map(chapters.map((c) => [c.id, c]));
  const ranked: CompanionChapter[] = [];
  for (const m of res.matches) {
    const orig = m.folderName ? byId.get(m.folderName) : undefined;
    if (orig) ranked.push(orig);
    if (ranked.length >= limit) break;
  }
  return ranked;
}

/**
 * Format companion snippets as an LLM system-prompt block. Textbooks are
 * explicitly marked supplementary and possibly beyond syllabus scope; the
 * current lecture stays the primary ground truth.
 */
export function buildCompanionBlock(snippets: CompanionSnippet[]): string {
  if (snippets.length === 0) return '';
  const blocks = snippets.map((s) => {
    const body =
      s.snippet.length > MAX_CHARS_PER_COMPANION
        ? s.snippet.slice(0, MAX_CHARS_PER_COMPANION).trim() + '…'
        : s.snippet;
    return `### [Textbook: ${s.title}]\n${body}`;
  });
  return (
    `\n\n## TEXTBOOK SOURCES (supplementary — same subject, standard textbook)\n` +
    `The current lecture above is the PRIMARY ground truth and defines the syllabus scope. Use these textbook excerpts ONLY when they add genuine depth, a clearer explanation, or background the lecture notes lack. Textbooks may go beyond the syllabus — say so when they do. When you use them, cite inline like [Textbook: <title>]. Never invent chapter titles.\n` +
    blocks.join('\n\n')
  );
}

/**
* Deterministic post-processor for assistant replies:
* - Strips upstream safety classifier prefixes
* - Converts `*   item` or `• item` bullets to `- item`
* - Removes blank lines between consecutive bullet or numbered list items
* - Normalizes `#`, `##`, `####` headings to `###`
* - Collapses 3+ consecutive newlines to 2
*/
export function normalizeAssistantReply(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n');

  // Strip safety classifier prefixes
  text = text.replace(/^UserSafety\s*:\s*safe\s*(\n+|$)/i, '').trim();

  // Normalize line-by-line Outside of fenced code blocks
  const lines = text.split('\n');
  let inCodeFence = false;
  const normalizedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      normalizedLines.push(line);
      continue;
    }
    if (inCodeFence) {
      normalizedLines.push(line);
      continue;
    }

    // Convert `*   item` or `• item` at start of line into `- item` (without breaking `**bold**`)
    let cleanLine = line.replace(/^\s*(?:\*(?!\*)|[•‣▪])\s+/, '- ');

    // Normalize H1/H2/H4+ markdown headings to `### `
    cleanLine = cleanLine.replace(/^#{1,2}\s+(.+)$/, '### $1');
    cleanLine = cleanLine.replace(/^#{4,6}\s+(.+)$/, '### $1');

    // Strip standalone horizontal rules `---` or `***`
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(cleanLine)) {
      continue;
    }

    normalizedLines.push(cleanLine);
  }

  // Remove blank lines between consecutive list items (`- ` or `1. `)
  const compactLines: string[] = [];
  const isListItem = (s: string) => /^\s*(?:-\s+|\d+\.\s+)/.test(s);

  for (let i = 0; i < normalizedLines.length; i++) {
    const curr = normalizedLines[i];
    if (
      curr.trim() === '' &&
      compactLines.length > 0 &&
      isListItem(compactLines[compactLines.length - 1])
    ) {
      // Look ahead for next non-empty line
      let nextIdx = i + 1;
      while (nextIdx < normalizedLines.length && normalizedLines[nextIdx].trim() === '') {
        nextIdx++;
      }
      if (nextIdx < normalizedLines.length && isListItem(normalizedLines[nextIdx])) {
        continue; // Skip blank line between two list items
      }
    }
    compactLines.push(curr);
  }

  return compactLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function companionCacheKey(subject: string, suffix: string): Request {
  return new Request(
    `https://internal.bitsnotes/cache/companion/${encodeURIComponent(subject)}/${suffix}`
  );
}

async function getCompanionCache(): Promise<Cache | null> {
  try {
    const env = await getEnv();
    const fromEnv = (env as any)?.caches?.default as Cache | undefined;
    if (fromEnv) return fromEnv;
    const fromGlobal = (globalThis as any)?.caches?.default as Cache | undefined;
    return fromGlobal ?? null;
  } catch {
    return null;
  }
}

/** Load and cache the per-subject companion index. Returns null when unavailable. */
async function getCompanionIndex(subject: string): Promise<CompanionChapter[] | null> {
  const now = Date.now();
  const cached = companionIndexCache.get(subject);
  if (cached && now - cached.time < COMPANION_INDEX_TTL_MS) return cached.data;

  try {
    const env = await getEnv();
    const bucket = (env as any)?.NOTES_BUCKET;
    if (!bucket) return null;

    const cache = await getCompanionCache();
    const cacheKey = companionCacheKey(subject, 'index.json');
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const payload = (await hit.json()) as { chapters?: CompanionChapter[] };
          const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
          companionIndexCache.set(subject, { data: chapters, time: now });
          return chapters;
        }
      } catch { /* cache read is best-effort */ }
    }

    const obj = await bucket.get(`companion/${subject}/index.json`);
    if (!obj) return null;
    const payload = (await obj.json()) as { chapters?: CompanionChapter[] };
    const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];

    if (cache) {
      try {
        const res = new Response(JSON.stringify({ chapters }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
        cache.put(cacheKey, res).catch(() => {});
      } catch { /* best-effort */ }
    }

    companionIndexCache.set(subject, { data: chapters, time: now });
    return chapters;
  } catch (err) {
    console.error('[chatbotRetrieval] Non-fatal companion index failure:', err);
    return null;
  }
}

/** Fetch one full chapter text via a byte-range read on the subject bundle. */
async function getCompanionChapterText(
  subject: string,
  chapter: CompanionChapter
): Promise<string> {
  try {
    if (chapter.offset == null || chapter.length == null || chapter.length <= 0) return '';
    const env = await getEnv();
    const bucket = (env as any)?.NOTES_BUCKET;
    if (!bucket) return '';

    // Range reads are cheap and precise — no edge-cache layer needed
    // (Cache API handles Range requests poorly); a range GET pulls only
    // the ~70KB chapter out of the multi-MB subject bundle.
    const obj = await bucket.get(`companion/${subject}/bundle.json`, {
      range: { offset: chapter.offset, length: chapter.length },
    });
    if (!obj) return '';
    return (await obj.text()) || '';
  } catch (err) {
    console.error('[chatbotRetrieval] Non-fatal companion chapter failure:', err);
    return '';
  }
}

/**
 * Main entry: find up to COMPANION_LIMIT textbook snippets for a query,
 * scoped to the current subject only. Never throws — returns [] on any
 * failure so chat degrades gracefully.
 */
export async function getCompanionSnippets(opts: {
  subject: string;
  query: string;
  limit?: number;
}): Promise<CompanionSnippet[]> {
  const { subject } = opts;
  const limit = Math.min(opts.limit ?? COMPANION_LIMIT, COMPANION_LIMIT);
  try {
    const q = (opts.query || '').trim();
    if (!subject || !q || q.length < MIN_QUERY_LENGTH) return [];
    const { isPureStopWords } = tokenizeQuery(q);
    if (isPureStopWords) return [];

    const chapters = await getCompanionIndex(subject);
    if (!chapters || chapters.length === 0) return [];

    const ranked = rankCompanionCandidates(chapters, q, limit);
    if (ranked.length === 0) return [];

    const results = await Promise.all(
      ranked.map(async (ch): Promise<CompanionSnippet | null> => {
        try {
          const raw = await getCompanionChapterText(subject, ch);
          const fullText = cleanPlainText(raw);
          if (fullText.length < 100) return null;
          const snippet = extractSnippetWindow(fullText, q, MAX_CHARS_PER_COMPANION);
          if (!snippet) return null;
          return { subject, chapterId: ch.id, title: ch.title, book: ch.book, snippet };
        } catch {
          return null;
        }
      })
    );

    return results.filter((r): r is CompanionSnippet => r !== null).slice(0, limit);
  } catch (err) {
    console.error('[chatbotRetrieval] Non-fatal companion retrieval failure:', err);
    return [];
  }
}
