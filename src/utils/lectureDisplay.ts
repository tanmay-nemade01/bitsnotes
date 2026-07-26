/**
 * lectureDisplay.ts
 *
 * Phase 2 catalog normalization. Turns a raw manifest lecture entry
 * (folder name + metadata) into a stable, render-ready `CatalogEntry`.
 *
 * Key rules (from the implementation plan, Phase 2.2):
 *   1. Prefer `metadata.lectureNumber`.
 *   2. Else parse the folder name (`Lecture_07`, `Lecture 7`, `Lecture_1_and_2`).
 *   3. NEVER derive the lecture number from an array index (`idx + 1`).
 *   4. Render examples:
 *        - `Lecture 07 · POS Tagging and HMMs`
 *        - `Lectures 01–02 · Foundations`
 *      Non-lecture resources:
 *        - `Race Card · MDP → DP → MC → TD`
 *        - `One Sheet · NLP Exam Revision`
 *
 * The helper is the single source of truth for catalog display strings and
 * is consumed by the homepage, subject page, viewer sidebar, prev/next,
 * search results, bookmarks, and JSON-LD.
 */

import type {
  DocumentMetadata,
  ResourceKind,
  AvailableMode,
  ResourceScope,
  MetadataSource,
} from './metadata';

export interface CatalogEntry {
  subject: string;
  folderName: string;
  fileName: string;
  /** Raw display name (filename with underscores → spaces). */
  name: string;
  /** Canonical display title, e.g. "Lecture 07 · POS Tagging and HMMs". */
  displayTitle: string;
  /** Topic title without the lecture-number prefix, e.g. "POS Tagging and HMMs". */
  topicTitle: string;
  slug: string;
  lectureNumber?: number;
  lectureNumberEnd?: number;
  resourceKind: ResourceKind;
  availableModes: AvailableMode[];
  scope: ResourceScope;
  sortOrder: number;
  shortDescription?: string;
  topics?: string[];
  metadataSource: MetadataSource;
  /** Authored quiz question count (0 unless metadata is authored). */
  authoredQuizCount: number;
}

export function extractCanonicalSlug(htmlContent?: string | null): string | null {
  if (!htmlContent) return null;
  const match = htmlContent.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
                htmlContent.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (!match) return null;
  const urlStr = match[1].trim();
  try {
    const urlObj = new URL(urlStr);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  } catch {
    const parts = urlStr.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return null;
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')        // Replace spaces and underscores with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars except -
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '');            // Trim - from end
}

export interface RawCatalogEntry {
  subject: string;
  folderName: string;
  fileName: string;
  /** Raw display name (filename with underscores → spaces). */
  name: string;
  metadata?: DocumentMetadata | null;
  htmlContent?: string | null;
}

// ─── Resource-kind detection ────────────────────────────────────────────────

const RESOURCE_KIND_PATTERNS: Array<[RegExp, ResourceKind]> = [
  [/solved/i, 'solved-paper'],
  [/one[_\s-]?sheet/i, 'one-sheet'],
  [/worksheet/i, 'worksheet'],
  [/question[_\s-]?bank/i, 'question-bank'],
  [/concept[_\s-]?map/i, 'concept-map'],
  [/race[_\s-]?card/i, 'race-card'],
];

export function detectResourceKind(
  folderName: string,
  metadata?: DocumentMetadata | null,
): ResourceKind {
  if (metadata?.resourceKind) return metadata.resourceKind;
  for (const [re, kind] of RESOURCE_KIND_PATTERNS) {
    if (re.test(folderName)) return kind;
  }
  return 'lecture';
}

export function getResourceKindLabel(kind: ResourceKind): string {
  switch (kind) {
    case 'lecture': return 'Lecture';
    case 'solved-paper': return 'Solved Paper';
    case 'one-sheet': return 'One Sheet';
    case 'worksheet': return 'Worksheet';
    case 'question-bank': return 'Question Bank';
    case 'concept-map': return 'Concept Map';
    case 'race-card': return 'Race Card';
  }
}

// ─── Lecture-number parsing (never from array index) ────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Parse lecture numbers from a folder name. Supports:
 *   - `Lecture_07`, `Lecture 7`, `Lecture07`
 *   - ranges: `Lecture_1_and_2`, `Lecture 1 and 2`, `Lecture 1-2`
 * Returns {} when no number is found (caller must not fall back to idx + 1).
 */
export function parseFolderLectureNumbers(
  folderName: string,
): { start?: number; end?: number } {
  // Range first: "1_and_2", "1 and 2", "1-2" (en-dash or hyphen)
  const range =
    folderName.match(/(\d+)[_\s-]*and[_\s-]*(\d+)/i) ??
    folderName.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (range) {
    return { start: parseInt(range[1], 10), end: parseInt(range[2], 10) };
  }
  // Single: "Lecture_07", "Lecture 7"
  const single = folderName.match(/lecture[_\s-]*(\d+)/i);
  if (single) {
    return { start: parseInt(single[1], 10) };
  }
  return {};
}

// ─── Topic-title derivation ─────────────────────────────────────────────────

function deriveTopicTitle(
  folderName: string,
  _subject: string,
  metadata?: DocumentMetadata | null,
): string {
  if (metadata?.topicTitle) return metadata.topicTitle;
  if (metadata?.title) return metadata.title;

  let t = folderName;
  // Strip a leading subject code, e.g. "NLP_", "DRL_"
  t = t.replace(/^[A-Za-z]{2,5}[_\s-]+/, '');
  // Strip "Lecture N" / "Lecture N and M"
  t = t.replace(/lecture[_\s-]*\d+(?:[_\s-]*and[_\s-]*\d+)?/i, '');
  // Strip trailing resource markers
  t = t.replace(
    /[_\s-]*(notes?|solved|regular|midsem|one[_\s-]?sheet|worksheet|question[_\s-]?bank|concept[_\s-]?map|race[_\s-]?card)\b/gi,
    '',
  );
  t = t.replace(/[_\s-]+/g, ' ').trim();
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// ─── Display-label formatting ───────────────────────────────────────────────

export function formatLectureLabel(opts: {
  lectureNumber?: number;
  lectureNumberEnd?: number;
  topicTitle?: string;
  resourceKind?: ResourceKind;
}): string {
  const { lectureNumber, lectureNumberEnd, topicTitle, resourceKind } = opts;
  const isLecture = resourceKind === 'lecture' || resourceKind === undefined;

  let prefix: string;
  if (isLecture) {
    if (lectureNumber != null && lectureNumberEnd != null) {
      prefix = `Lectures ${pad2(lectureNumber)}–${pad2(lectureNumberEnd)}`;
    } else if (lectureNumber != null) {
      prefix = `Lecture ${pad2(lectureNumber)}`;
    } else {
      prefix = '';
    }
  } else {
    prefix = getResourceKindLabel(resourceKind);
  }

  if (topicTitle) {
    return prefix ? `${prefix} · ${topicTitle}` : topicTitle;
  }
  return prefix;
}

// ─── Default modes / sort order ─────────────────────────────────────────────

function defaultModesFor(
  metadata: DocumentMetadata | null | undefined,
  resourceKind: ResourceKind,
  authored: boolean,
): AvailableMode[] {
  const modes: AvailableMode[] = ['notes', 'study-guide'];
  if (!authored) return modes; // fallback must not advertise quiz/revision
  if (metadata?.examRevisionNotes && metadata.examRevisionNotes.length > 0) {
    modes.push('exam-revision');
  }
  if (metadata?.quiz && metadata.quiz.length > 0) {
    modes.push('quiz');
  }
  // Subject-level resources may still expose revision even without notes body.
  if (resourceKind !== 'lecture' && !modes.includes('exam-revision')) {
    modes.push('exam-revision');
  }
  return modes;
}

function defaultSortOrder(
  resourceKind: ResourceKind,
  lectureNumber?: number,
  _lectureNumberEnd?: number,
): number {
  if (resourceKind === 'lecture') {
    // Use the start of the range when present, else the single number.
    return lectureNumber ?? 999;
  }
  // Subject-level cross-lecture resources sort after lectures.
  return 1000;
}

// ─── Normalization entry point ──────────────────────────────────────────────

export function normalizeCatalogEntry(entry: RawCatalogEntry): CatalogEntry {
  const { subject, folderName, fileName, name, metadata, htmlContent } = entry;

  const resourceKind = detectResourceKind(folderName, metadata);
  const scope: ResourceScope =
    metadata?.scope ?? (resourceKind === 'lecture' ? 'lecture' : 'subject');

  const folderNums = parseFolderLectureNumbers(folderName);
  const lectureNumber = metadata?.lectureNumber ?? folderNums.start;
  const lectureNumberEnd = metadata?.lectureNumberEnd ?? folderNums.end;

  const topicTitle = deriveTopicTitle(folderName, subject, metadata);

  const metadataSource: MetadataSource = metadata?.metadataSource ?? 'fallback';
  const authored = metadataSource !== 'fallback';

  // Authored quiz count: only when metadata is authored (companion/embedded).
  const authoredQuizCount = authored ? (metadata?.quiz?.length ?? 0) : 0;

  const availableModes =
    metadata?.availableModes ?? defaultModesFor(metadata, resourceKind, authored);

  const sortOrder =
    metadata?.sortOrder ?? defaultSortOrder(resourceKind, lectureNumber, lectureNumberEnd);

  const displayTitle = formatLectureLabel({
    lectureNumber,
    lectureNumberEnd,
    topicTitle,
    resourceKind,
  });

  const canonicalSlug = extractCanonicalSlug(htmlContent);
  const slug = (metadata && metadata.slug) || canonicalSlug || slugify(topicTitle) || slugify(folderName);

  return {
    subject,
    folderName,
    fileName,
    name,
    displayTitle,
    topicTitle,
    slug,
    lectureNumber,
    lectureNumberEnd,
    resourceKind,
    availableModes,
    scope,
    sortOrder,
    shortDescription: metadata?.shortDescription,
    topics: metadata?.topics,
    metadataSource,
    authoredQuizCount,
  };
}
