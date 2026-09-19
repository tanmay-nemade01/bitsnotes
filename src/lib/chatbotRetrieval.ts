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

// ─── Textbook companion (per-subject supplementary chapters) ─────────────
export const COMPANION_LIMIT = 1;
export const MAX_CHARS_PER_COMPANION = 1500;
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
  // Strip leading source-book tag: T1_, R12_, etc.
  t = t.replace(/^[TR]\d+_/i, '');
  // Strip leading chapter/section number tag: Ch01_, Chapter_10_, Lecture_3_, LN-1-, etc.
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
