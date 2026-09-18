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
