// src/utils/searchEngine.ts - High performance client-side search engine with stop-words optimization and lazy search

export interface RawSearchItem {
  type?: 'note' | 'blog' | 'bit' | string;
  title: string;
  subject: string;
  folderName?: string;
  slug: string;
  topicTitle?: string;
  text?: string;
  snippet?: string;
}

export interface PreparedSearchItem extends RawSearchItem {
  _titleLower: string;
  _subjectLower: string;
  _topicLower: string;
  _textLower: string;
  _previewSnippet: string;
}

export interface SearchMatch {
  item: PreparedSearchItem;
  score: number;
}

export interface SearchResult {
  status: 'empty' | 'too_short' | 'ready';
  query: string;
  matches: PreparedSearchItem[];
}

/**
 * Standard English stop words list.
 * Common conjunctions, prepositions, articles, and auxiliary verbs that appear
 * thousands of times across documents and distort search scoring.
 */
export const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'arent', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'couldn', 'couldnt', 'did', 'didn', 'didnt', 'do', 'does', 'doesn', 'doesnt',
  'doing', 'don', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'hadn', 'hadnt', 'has', 'hasn', 'hasnt', 'have', 'haven',
  'havent', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'isnt', 'it', 'its',
  'itself', 'just', 'll', 'm', 'me', 'might', 'more', 'most', 'must', 'mustn',
  'mustnt', 'my', 'myself', 'no', 'nor', 'not', 'now', 'o', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 're', 's', 'same', 'shan', 'shant', 'she', 'should',
  'shouldn', 'shouldnt', 'so', 'some', 'such', 't', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've',
  'very', 'was', 'wasn', 'wasnt', 'we', 'were', 'weren', 'werent', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'won', 'wont', 'would', 'wouldn', 'wouldnt', 'y', 'you', 'your', 'yours',
  'yourself', 'yourselves'
]);

/**
 * Pre-computes lowercased strings and pre-sliced previews once upon index load
 * to eliminate runtime allocations during keystrokes.
 */
export function prepareSearchIndex(rawItems: RawSearchItem[]): PreparedSearchItem[] {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item) => {
    const rawText = item.text || item.snippet || '';
    const snippet = item.snippet || rawText.slice(0, 300);

    return {
      ...item,
      _titleLower: (item.title || '').toLowerCase(),
      _subjectLower: (item.subject || '').toLowerCase(),
      _topicLower: (item.topicTitle || '').toLowerCase(),
      _textLower: rawText.toLowerCase(),
      _previewSnippet: snippet
    };
  });
}

/**
 * Splits query string into distinct normalized tokens and categorizes them.
 */
export function tokenizeQuery(rawQuery: string): {
  cleanQuery: string;
  allTerms: string[];
  meaningfulTerms: string[];
  stopWords: string[];
  isPureStopWords: boolean;
} {
  const cleanQuery = rawQuery.trim().toLowerCase();
  if (!cleanQuery) {
    return { cleanQuery: '', allTerms: [], meaningfulTerms: [], stopWords: [], isPureStopWords: false };
  }

  // Tokenize by whitespace and common punctuation
  const allTerms = cleanQuery
    .split(/[\s,._\-+/\\|:;()]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const meaningfulTerms = allTerms.filter((t) => !STOP_WORDS.has(t) && t.length >= 2);
  const stopWords = allTerms.filter((t) => STOP_WORDS.has(t));
  const isPureStopWords = allTerms.length > 0 && meaningfulTerms.length === 0;

  return {
    cleanQuery,
    allTerms,
    meaningfulTerms,
    stopWords,
    isPureStopWords
  };
}

/**
 * Safe helper to count occurrences up to a hard cap without runaway CPU loops.
 */
function countOccurrences(text: string, term: string, maxCount = 5): number {
  if (!term || term.length === 0 || !text) return 0;
  let count = 0;
  let pos = 0;
  const step = Math.max(1, term.length);
  while (count < maxCount) {
    pos = text.indexOf(term, pos);
    if (pos === -1) break;
    count++;
    pos += step;
  }
  return count;
}

/**
 * Executes optimized search over prepared index.
 * Handles lazy character thresholds and stop word filtering automatically.
 */
export function executeSearch(
  preparedIndex: PreparedSearchItem[],
  rawQuery: string,
  maxResults = 20
): SearchResult {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { status: 'empty', query: '', matches: [] };
  }

  // Lazy threshold: short 1-char input is handled internally without freezing
  if (trimmed.length < 2) {
    return { status: 'too_short', query: trimmed, matches: [] };
  }

  const { cleanQuery, allTerms, meaningfulTerms, isPureStopWords } = tokenizeQuery(trimmed);

  if (allTerms.length === 0) {
    return { status: 'empty', query: trimmed, matches: [] };
  }

  // Determine active search terms:
  // - If user typed only stop words (e.g. "the", "if then"), search for those stop words
  //   strictly in title/topic/subject metadata (never deep body text).
  // - If user typed mixed terms (e.g. "regression and classification"), search primarily on meaningful terms.
  const activeTerms = isPureStopWords ? allTerms : meaningfulTerms;
  const allowDeepBodySearch = !isPureStopWords && cleanQuery.length >= 3;

  const matchedItems: SearchMatch[] = [];

  for (let i = 0; i < preparedIndex.length; i++) {
    const item = preparedIndex[i];
    let score = 0;
    let termsMatchedCount = 0;

    // 1. Exact full query phrase match
    if (cleanQuery.length >= 2) {
      if (item._titleLower === cleanQuery) {
        score += 2000;
      } else if (item._titleLower.includes(cleanQuery)) {
        score += 1000;
      }

      if (item._topicLower.includes(cleanQuery)) {
        score += 700;
      }

      if (item._subjectLower.includes(cleanQuery)) {
        score += 300;
      }

      // Exact phrase match in deep text (only for queries >= 3 chars and not pure stop words)
      if (allowDeepBodySearch && item._textLower.includes(cleanQuery)) {
        const occurrences = countOccurrences(item._textLower, cleanQuery, 4);
        score += 400 + occurrences * 40;
      }
    }

    // 2. Term-by-term matching
    for (let t = 0; t < activeTerms.length; t++) {
      const term = activeTerms[t];
      let termMatched = false;

      // Title match
      const titleIdx = item._titleLower.indexOf(term);
      if (titleIdx !== -1) {
        termMatched = true;
        score += titleIdx === 0 ? 250 : 120;
      }

      // Topic match
      const topicIdx = item._topicLower.indexOf(term);
      if (topicIdx !== -1) {
        termMatched = true;
        score += topicIdx === 0 ? 180 : 90;
      }

      // Subject match
      const subjectIdx = item._subjectLower.indexOf(term);
      if (subjectIdx !== -1) {
        termMatched = true;
        score += subjectIdx === 0 ? 60 : 30;
      }

      // Body text match (only for non-stop words with sufficient length)
      if (allowDeepBodySearch && !STOP_WORDS.has(term)) {
        const textIdx = item._textLower.indexOf(term);
        if (textIdx !== -1) {
          termMatched = true;
          const count = countOccurrences(item._textLower, term, 4);
          score += 25 + count * 5;
        }
      }

      if (termMatched) {
        termsMatchedCount++;
      }
    }

    // 3. Multi-term coverage scoring
    if (termsMatchedCount > 0) {
      if (termsMatchedCount === activeTerms.length) {
        score += 200; // Bonus for containing all searched terms
      } else {
        score = score * (termsMatchedCount / activeTerms.length);
      }

      matchedItems.push({ item, score });
    }
  }

  // Sort by score descending and return top matches
  matchedItems.sort((a, b) => b.score - a.score);
  const topMatches = matchedItems.slice(0, maxResults).map((m) => m.item);

  return {
    status: 'ready',
    query: trimmed,
    matches: topMatches
  };
}

/**
 * Escapes HTML characters in snippet strings.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates an efficient highlighted title.
 */
export function getSearchTitle(title: string, rawQuery: string): string {
  const escaped = escapeHtml(title || '');
  const { meaningfulTerms, isPureStopWords, allTerms } = tokenizeQuery(rawQuery);
  const termsToHighlight = isPureStopWords ? allTerms : meaningfulTerms;

  if (termsToHighlight.length === 0) return escaped;

  const sortedTerms = [...termsToHighlight]
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (sortedTerms.length === 0) return escaped;

  let result = escaped;
  for (const term of sortedTerms) {
    const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    result = result.replace(
      regex,
      '<mark class="bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold px-0.5 rounded-[2px]">$1</mark>'
    );
  }

  return result;
}

/**
 * Sub-millisecond snippet extraction that slices a small window
 * before escaping and highlighting to avoid freezing large documents.
 */
export function getSearchSnippet(
  text: string,
  rawQuery: string,
  maxLen = 160
): string {
  if (!text) return '';
  const trimmed = (rawQuery || '').trim();
  if (!trimmed) {
    const preview = text.slice(0, maxLen);
    return escapeHtml(preview) + (text.length > maxLen ? '...' : '');
  }

  const { cleanQuery, meaningfulTerms, allTerms, isPureStopWords } = tokenizeQuery(trimmed);
  const searchTerms = isPureStopWords ? allTerms : meaningfulTerms;
  const lowerText = text.toLowerCase();

  let firstIndex = -1;
  let matchedLength = 0;

  // 1. Locate full query phrase in text
  if (cleanQuery.length >= 2) {
    const phraseIdx = lowerText.indexOf(cleanQuery);
    if (phraseIdx !== -1) {
      firstIndex = phraseIdx;
      matchedLength = cleanQuery.length;
    }
  }

  // 2. Locate first occurrence of any meaningful term
  if (firstIndex === -1 && searchTerms.length > 0) {
    for (const term of searchTerms) {
      const idx = lowerText.indexOf(term);
      if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
        firstIndex = idx;
        matchedLength = term.length;
      }
    }
  }

  // If no match in text (e.g. matched in title or topic), return start of text
  if (firstIndex === -1) {
    const preview = text.slice(0, maxLen);
    return escapeHtml(preview) + (text.length > maxLen ? '...' : '');
  }

  // Extract a small ~160 character window around the match
  const start = Math.max(0, firstIndex - 50);
  const end = Math.min(text.length, firstIndex + matchedLength + 100);
  let snippet = text.slice(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  let escaped = escapeHtml(snippet);

  // Highlight terms
  const termsToHighlight = (searchTerms.length > 0 ? searchTerms : [cleanQuery])
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);

  for (const term of termsToHighlight) {
    const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    escaped = escaped.replace(
      regex,
      '<mark class="bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold px-0.5 rounded-[2px]">$1</mark>'
    );
  }

  return escaped;
}
