import type { Topic } from './topicSplitter';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

/**
 * Balances any unclosed HTML tags in a sliced HTML string by appending
 * the matching closing tags in reverse order.
 */
export function balanceHtml(html: string): string {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*?)?(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isSelfClosing = match[2] === '/' || VOID_TAGS.has(tagName);
    const isClosing = fullTag.startsWith('</');

    if (isSelfClosing) continue;

    if (isClosing) {
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    } else {
      stack.push(tagName);
    }
  }

  let balanced = html;
  while (stack.length > 0) {
    balanced += `</${stack.pop()}>`;
  }
  return balanced;
}

/**
 * Strips any stray leading closing tags (e.g. `</div>`, `</blockquote>`) caused by slicing.
 */
export function cleanLeadingClosingTags(html: string): string {
  return html.replace(/^\s*(?:<\/[a-zA-Z0-9]+>\s*)+/, '');
}

export interface GatedContentResult {
  teaserTopics: Topic[];
  blurredHtml: string;
}

/**
 * Splits the topics for non-signed-in visitors into a clear readable teaser
 * and a short blurred preview snippet that renders directly above the paywall card.
 */
export function getGatedContent(allTopics: Topic[]): GatedContentResult {
  if (!allTopics || allTopics.length === 0) {
    return { teaserTopics: [], blurredHtml: '' };
  }

  const topic0 = allTopics[0];
  const tHtml = topic0.html;

  const pRegex = /<\/p>/gi;
  const pIndices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(tHtml)) !== null) {
    pIndices.push(m.index + m[0].length);
  }

  const totalP = pIndices.length;
  let clearCutIndex = 5;
  let blurCutIndex = 9;

  if (totalP >= 8) {
    clearCutIndex = 5;
    blurCutIndex = 9;
  } else if (totalP >= 5) {
    clearCutIndex = 3;
    blurCutIndex = Math.min(totalP, clearCutIndex + 3);
  } else if (totalP >= 3) {
    clearCutIndex = 2;
    blurCutIndex = totalP;
  } else {
    clearCutIndex = Math.max(1, totalP);
    blurCutIndex = totalP;
  }

  const clearTarget = pIndices[Math.min(clearCutIndex - 1, totalP - 1)] || tHtml.length;
  const blurTarget = pIndices[Math.min(blurCutIndex - 1, totalP - 1)] || tHtml.length;

  const rawClear = tHtml.slice(0, clearTarget);
  const rawBlur = cleanLeadingClosingTags(tHtml.slice(clearTarget, blurTarget));

  const balancedClear = balanceHtml(rawClear);
  let balancedBlur = balanceHtml(rawBlur);

  // If blur content is too short and topic 1 exists, take a short snippet from topic 1
  if (balancedBlur.replace(/<[^>]+>/g, '').trim().length < 80 && allTopics.length > 1) {
    const t1 = allTopics[1];
    const t1PMatches = [...t1.html.matchAll(/<\/p>/gi)];
    if (t1PMatches.length > 0) {
      const t1End = t1PMatches[Math.min(2, t1PMatches.length - 1)].index + 4;
      const t1Snippet = balanceHtml(cleanLeadingClosingTags(t1.html.slice(0, t1End)));
      balancedBlur += t1Snippet;
    }
  }

  return {
    teaserTopics: [{ ...topic0, html: balancedClear, subtopics: [] }],
    blurredHtml: balancedBlur,
  };
}
