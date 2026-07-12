import { describe, it, expect } from 'vitest';
import { parseLectureHtml } from '../src/utils/htmlParser';

const LECTURE = `<!DOCTYPE html>
<html>
<head>
  <style>
    .my-box { color: #123456; padding: 8px; }
    h2 { font-weight: 700; }
    @media (max-width: 600px) { .my-box { padding: 4px; } }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="my-box">Hello</div>
  <section class="exam-revision-section"><p>rev</p></section>
  <section class="quiz-section"><p>quiz</p></section>
</body>
</html>`;

describe('parseLectureHtml', () => {
  it('scopes content styles to .lecture-notes-wrapper (theme isolation)', () => {
    const { inlineStyles } = parseLectureHtml(LECTURE);
    expect(inlineStyles).toContain('.lecture-notes-wrapper .my-box');
    expect(inlineStyles).toContain('.lecture-notes-wrapper h2');
    // Regression guard: the <style> wrapper tag must NOT leak into a selector.
    expect(inlineStyles).not.toContain('.lecture-notes-wrapper <style>');
    expect(inlineStyles.startsWith('.lecture-notes-wrapper')).toBe(true);
  });

  it('does NOT scope @-rules but preserves the at-rule keyword (media, keyframes)', () => {
    const { inlineStyles } = parseLectureHtml(LECTURE);
    expect(inlineStyles).toContain('@media (max-width: 600px)');
    expect(inlineStyles).toContain('@keyframes spin');
    expect(inlineStyles).not.toContain('.lecture-notes-wrapper @media');
    // Regression guard: the at-rule prelude must not be dropped (it must read
    // `@media (max-width: 600px) { ... }`, not `{ .my-box { ... } }`).
    expect(inlineStyles).toContain('@media (max-width: 600px) { .my-box');
    expect(inlineStyles).toContain('@keyframes spin { to');
  });

  it('strips bare body / .container / .hidden / :root rules', () => {
    const { inlineStyles } = parseLectureHtml(LECTURE);
    expect(inlineStyles).not.toMatch(/body\s*\{/);
    expect(inlineStyles).not.toMatch(/\.container\s*\{/);
    expect(inlineStyles).not.toMatch(/\.hidden\s*\{/);
    expect(inlineStyles).not.toMatch(/:root\s*\{/);
  });

  it('extracts and removes exam-revision and quiz sections from body', () => {
    const { bodyContent, hasRevisionSection, hasQuizSection } = parseLectureHtml(LECTURE);
    expect(hasRevisionSection).toBe(true);
    expect(hasQuizSection).toBe(true);
    expect(bodyContent).not.toContain('exam-revision-section');
    expect(bodyContent).not.toContain('quiz-section');
  });

  it('keeps the main content body', () => {
    const { bodyContent } = parseLectureHtml(LECTURE);
    expect(bodyContent).toContain('Hello');
  });

  it('wraps prepended inline styles in a <style> tag', () => {
    const { bodyContent } = parseLectureHtml(LECTURE);
    expect(bodyContent.trim().startsWith('<style>')).toBe(true);
    expect(bodyContent).toContain('</style>');
  });
});
