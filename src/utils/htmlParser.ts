export interface ParsedLectureHtml {
  bodyContent: string;
  inlineStyles: string;
  hasRevisionSection: boolean;
  revisionSectionContent: string;
  hasQuizSection: boolean;
  quizSectionContent: string;
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
export function parseLectureHtml(htmlContent: string): ParsedLectureHtml {
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
    const styleMatches = headContent.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
    if (styleMatches) {
      inlineStyles = styleMatches.join('');
    }
  }

  // Strip conflicting unscoped CSS rules from inline styles that break mobile layout.
  // These rules (body padding, .container max-width) are already properly handled
  // with mobile-responsive overrides in lecture-notes.css via .lecture-notes-wrapper scoping.
  if (inlineStyles) {
    inlineStyles = inlineStyles
      .replace(/body\s*\{[^}]*\}/gi, '')
      .replace(/\.container\s*\{[^}]*\}/gi, '')
      .replace(/\.hidden\s*\{[^}]*\}/gi, '');
  }

  // Remove duplicate stylesheet link and duplicate body tags to prevent double loading
  bodyContent = bodyContent
    .replace(/<link[^>]*href=["']\/lecture-notes\.css["'][^>]*>/gi, '')
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

  // Prepend inline styles if extracted
  if (inlineStyles) {
    bodyContent = inlineStyles + bodyContent;
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
