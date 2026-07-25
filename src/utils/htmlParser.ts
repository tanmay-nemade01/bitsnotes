export interface ParsedLectureHtml {
  bodyContent: string;
  inlineStyles: string;
  hasRevisionSection: boolean;
  revisionSectionContent: string;
  hasQuizSection: boolean;
  quizSectionContent: string;
}

/**
 * Wrap every top-level selector in a content <style> block with
 * `.lecture-notes-wrapper` so the lecture's own CSS cannot leak into the
 * site chrome and so the canonical lecture-notes.css (loaded after the
 * content styles) can override it for theming.
 *
 * Only top-level selectors are prefixed; nested rules and @-rules (keyframes,
 * media queries) are left untouched. Selectors that already reference the
 * wrapper are skipped to avoid double-prefixing.
 */
function scopeStylesToWrapper(css: string): string {
  const WRAPPER = '.lecture-notes-wrapper';
  // Split into top-level rules. We walk char-by-char to respect braces.
  let out = '';
  let i = 0;
  const n = css.length;

  while (i < n) {
    // Find next rule start (selector) up to first '{' that is not inside a string.
    let depth = 0;
    let selectorEnd = -1;
    let j = i;
    // Skip leading whitespace
    while (j < n && /\s/.test(css[j])) j++;
    const ruleStart = j;
    // Find the matching opening brace for the top-level rule
    while (j < n) {
      const ch = css[j];
      if (ch === '{') { depth++; if (depth === 1) { selectorEnd = j; break; } }
      else if (ch === '}') depth--;
      else if (ch === '(') { /* skip paren groups (e.g. :not(...)) */ while (j < n && css[j] !== ')') j++; }
      j++;
    }
    if (selectorEnd === -1) {
      // No more rules; append remainder (likely trailing whitespace/comments)
      out += css.slice(ruleStart);
      break;
    }
    const selector = css.slice(ruleStart, selectorEnd).trim();
    // Find matching closing brace
    let braceDepth = 1;
    let k = selectorEnd + 1;
    while (k < n && braceDepth > 0) {
      const ch = css[k];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      k++;
    }
    const block = css.slice(selectorEnd, k); // includes outer braces

    // Only scope real selector rules (skip @-rules like @media, @keyframes, @font-face).
    // For @-rules we must keep the at-rule keyword + its prelude (e.g.
    // `@media (max-width: 600px)`), which lives in `selector`, so we emit
    // `selector + block` rather than just `block`.
    if (selector.startsWith('@')) {
      out += `${selector} ${block}`;
    } else {
      const scopedSelector = selector
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith(WRAPPER) ? s : `${WRAPPER} ${s}`))
        .join(', ');
      out += `${scopedSelector} ${block}`;
    }
    i = k;
  }
  return out;
}

/**
 * Parse a raw lecture HTML file into the components needed by the viewer.
 *
 * Extracts:
 * - Body content (from <body> or fallback stripping)
 * - Inline <style> blocks from <head>
 * - Exam revision and quiz sections (removed from body content)
 *
 * Also sanitizes inline styles by removing bare body, .container, and .hidden
 * rules that would conflict with the viewer's layout.
 */
export function parseLectureHtml(htmlContent: string, extraCss?: string): ParsedLectureHtml {
  // Match body content case-insensitively
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent: string;

  if (bodyMatch) {
    bodyContent = bodyMatch[1];
  } else {
    // Fallback: strip outer html and head tags
    bodyContent = htmlContent
      .replace(/<!DOCTYPE html>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  }

  // Extract inline <style> blocks from <head> and prepend to body content
  const headStyleMatch = htmlContent.match(/<head[^>]*>[\s\S]*?<\/head>/i);
  let inlineStyles = '';
  if (headStyleMatch) {
    const headContent = headStyleMatch[0];
    const styleMatches = headContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (styleMatches) {
      inlineStyles = styleMatches
        .map((m) => m.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''))
        .join('\n');
    }
  }

  if (extraCss) {
    inlineStyles = (inlineStyles ? inlineStyles + '\n' : '') + extraCss;
  }

  // Strip conflicting unscoped CSS rules from inline styles that break mobile layout.
  if (inlineStyles) {
    inlineStyles = inlineStyles
      .replace(/body\s*\{[^}]*\}/gi, '')
      .replace(/\.container\s*\{[^}]*\}/gi, '')
      .replace(/\.hidden\s*\{[^}]*\}/gi, '')
      .replace(/:root\s*\{[^}]*\}/gi, '');

    // Scope the remaining content-specific rules to .lecture-notes-wrapper
    inlineStyles = scopeStylesToWrapper(inlineStyles);
  }

  // Remove duplicate stylesheet links and duplicate body tags to prevent double loading
  bodyContent = bodyContent
    .replace(/<link[^>]*href=["'][^"']*\.css["'][^>]*>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '');

  // Extract <section class="exam-revision-section"> if present in HTML bodyContent
  let hasRevisionSection = false;
  let revisionSectionContent = '';
  const revisionMatch = bodyContent.match(
    /<section[^>]*class=["']exam-revision-section["'][^>]*>([\s\S]*?)<\/section>/i
  );
  if (revisionMatch) {
    hasRevisionSection = true;
    revisionSectionContent = revisionMatch[0];
    bodyContent = bodyContent.replace(
      /<section[^>]*class=["']exam-revision-section["'][^>]*>([\s\S]*?)<\/section>/i,
      ''
    );
  }

  // Extract <section class="quiz-section"> if present in HTML bodyContent
  let hasQuizSection = false;
  let quizSectionContent = '';
  const quizMatch = bodyContent.match(
    /<section[^>]*class=["']quiz-section["'][^>]*>([\s\S]*?)<\/section>/i
  );
  if (quizMatch) {
    hasQuizSection = true;
    quizSectionContent = quizMatch[0];
    bodyContent = bodyContent.replace(
      /<section[^>]*class=["']quiz-section["'][^>]*>([\s\S]*?)<\/section>/i,
      ''
    );
  }

  // Remove script tags from the body content to prevent executing or double-rendering quiz scripts
  // and to avoid breaking JSON serialization.
  bodyContent = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Strip leading container div wrapper
  bodyContent = bodyContent.replace(/^\s*(<!--[\s\S]*?-->\s*)*<div[^>]*class=["'][^"']*container[^"']*["'][^>]*>/i, '');

  // Strip first <main> tag
  bodyContent = bodyContent.replace(/<main[^>]*>/i, '');

  // Strip trailing </main> and </div> tags from the end of the body
  bodyContent = bodyContent.replace(/<\/main>\s*(<!--[\s\S]*?-->\s*)*<\/div>\s*$/i, '');

  // Prepend inline styles if extracted
  if (inlineStyles) {
    bodyContent = `<style>${inlineStyles}</style>` + bodyContent;
  }

  return {
    bodyContent,
    inlineStyles,
    hasRevisionSection,
    revisionSectionContent,
    hasQuizSection,
    quizSectionContent,
  };
}
