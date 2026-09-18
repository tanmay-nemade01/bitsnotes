import { describe, it, expect } from 'vitest';
import {
  buildCandidateText,
  buildRelatedBlock,
  cleanHtmlToText,
  extractSnippetWindow,
  getLastUserQuery,
  parseSubjectFromSystemPrompt,
  rankCandidates,
  TOTAL_BUDGET_CHARS,
} from '../src/lib/chatbotRetrieval';

describe('chatbotRetrieval (lean cross-lecture RAG)', () => {
  describe('cleanHtmlToText', () => {
    it('strips tags/scripts and decodes entities', () => {
      const html = '<head><title>x</title></head><script>var a=1;</script><p>Hello&nbsp;&amp;&nbsp;world</p>';
      expect(cleanHtmlToText(html)).toBe('Hello & world');
    });

    it('returns empty for empty input', () => {
      expect(cleanHtmlToText('')).toBe('');
    });
  });

  describe('buildCandidateText', () => {
    it('combines titles, topics, concepts and section headings', () => {
      const text = buildCandidateText({
        folderName: 'L5',
        displayTitle: 'Lecture 05 · Gradient Descent',
        topicTitle: 'Gradient Descent',
        shortDescription: 'Optimization basics',
        topics: ['optimization'],
        metadata: {
          keyConcepts: ['learning rate'],
          sections: [{ title: 'Convergence', description: 'When descent stops' }],
        },
      });
      expect(text).toContain('Gradient Descent');
      expect(text).toContain('learning rate');
      expect(text).toContain('Convergence');
    });
  });

  describe('rankCandidates', () => {
    const lectures = [
      { folderName: 'L1', displayTitle: 'Lecture 01 · Linear Regression', topicTitle: 'Linear Regression' },
      { folderName: 'L2', displayTitle: 'Lecture 02 · Gradient Descent', topicTitle: 'Gradient Descent' },
      { folderName: 'L3', displayTitle: 'Lecture 03 · Decision Trees', topicTitle: 'Decision Trees' },
    ];

    it('ranks the matching lecture first and excludes current', () => {
      const ranked = rankCandidates(lectures, 'how does gradient descent converge?', 'L1', 2);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].folderName).toBe('L2');
      expect(ranked.find((l) => l.folderName === 'L1')).toBeUndefined();
    });

    it('returns [] for short or stop-word-only queries (no wasted R2 reads)', () => {
      expect(rankCandidates(lectures, 'a', 'L1')).toEqual([]);
      expect(rankCandidates(lectures, 'and the', 'L1')).toEqual([]);
      expect(rankCandidates(lectures, '', 'L1')).toEqual([]);
    });

    it('respects the limit', () => {
      const ranked = rankCandidates(lectures, 'lecture', 'L1', 1);
      expect(ranked.length).toBeLessThanOrEqual(1);
    });
  });

  describe('extractSnippetWindow', () => {
    it('centers on the query hit within budget', () => {
      const full = 'intro '.repeat(500) + 'gradient descent converges with small learning rate ' + 'outro '.repeat(500);
      const snippet = extractSnippetWindow(full, 'gradient descent', 500);
      expect(snippet).toContain('gradient descent');
      expect(snippet.length).toBeLessThanOrEqual(520);
    });

    it('returns prefix when no hit', () => {
      const full = 'a '.repeat(2000);
      const snippet = extractSnippetWindow(full, 'quantum', 200);
      expect(snippet.length).toBeLessThanOrEqual(220);
    });
  });

  describe('buildRelatedBlock', () => {
    it('returns empty for no snippets', () => {
      expect(buildRelatedBlock([])).toBe('');
    });

    it('caps total chars and instructs primary-vs-supplementary use', () => {
      const snippets = [
        { subject: 'ML', folderName: 'L2', title: 'Lecture 02', slug: 'l2', snippet: 'x'.repeat(4000) },
        { subject: 'ML', folderName: 'L3', title: 'Lecture 03', slug: 'l3', snippet: 'y'.repeat(4000) },
      ];
      const block = buildRelatedBlock(snippets);
      expect(block).toContain('RELATED LECTURES');
      expect(block).toContain('PRIMARY');
      expect(block).toContain('[Source: Lecture 02]');
      // Total body budget enforced (headers excluded from strict check, allow slack)
      expect(block.length).toBeLessThan(TOTAL_BUDGET_CHARS + 1000);
    });
  });

  describe('request parsing helpers', () => {
    it('parses subject/lecture from system prompt (back-compat)', () => {
      const sys = '- Subject: "Machine Learning"\n- Lecture: "L7_notes"\ncontent...';
      expect(parseSubjectFromSystemPrompt(sys)).toEqual({
        subject: 'Machine Learning',
        lectureFolder: 'L7_notes',
      });
    });

    it('gets last user query', () => {
      expect(
        getLastUserQuery([
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: '  second? ' },
        ])
      ).toBe('second?');
      expect(getLastUserQuery([{ role: 'assistant', content: 'hi' }])).toBe('');
    });
  });
});
