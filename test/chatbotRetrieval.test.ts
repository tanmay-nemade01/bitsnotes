import { describe, it, expect } from 'vitest';
import { setTestEnv } from './cloudflare-shim';
import {
  buildCandidateText,
  buildCompanionBlock,
  buildRelatedBlock,
  cleanHtmlToText,
  cleanPlainText,
  deriveChapterTitle,
  extractSnippetWindow,
  getCompanionSnippets,
  getLastUserQuery,
  MAX_CHARS_PER_COMPANION,
  parseSubjectFromSystemPrompt,
  rankCandidates,
  rankCompanionCandidates,
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

  describe('textbook companion retrieval', () => {
    describe('deriveChapterTitle', () => {
      it('strips book and chapter tags', () => {
        expect(deriveChapterTitle('T1_Ch01_Boolean_Retrieval.txt')).toBe('Boolean Retrieval');
        expect(deriveChapterTitle('R1_Ch06_Scoring_Term_Weighting_and_the_Vector_Space_Model.txt')).toBe(
          'Scoring Term Weighting and the Vector Space Model'
        );
        expect(deriveChapterTitle('R1_AppA_Porter_Algorithm.txt')).toBe('AppA Porter Algorithm');
        expect(deriveChapterTitle('R2_Ch03_Content_Based_Recommender_Systems_State_of_the_Art_and_Trends.txt')).toBe(
          'Content Based Recommender Systems State of the Art and Trends'
        );
      });

      it('falls back to the raw filename when nothing prettifiable remains', () => {
        expect(deriveChapterTitle('')).toBe('');
        expect(deriveChapterTitle('notes.txt')).toBe('notes');
      });
    });

    describe('cleanPlainText', () => {
      it('collapses whitespace', () => {
        expect(cleanPlainText('  hello\n\n  world \r\n test  ')).toBe('hello world test');
        expect(cleanPlainText('')).toBe('');
      });
    });

    describe('rankCompanionCandidates', () => {
      const chapters = [
        { id: 'T1_Ch01_Boolean_Retrieval', title: 'Boolean Retrieval', book: 'T1', preview: 'boolean model query operators' },
        { id: 'T1_Ch06_Scoring', title: 'Scoring Term Weighting', book: 'T1', preview: 'tf-idf vector space cosine' },
        { id: 'T1_Ch08_Evaluation', title: 'Evaluation in IR', book: 'T1', preview: 'precision recall f-measure' },
      ];

      it('ranks the matching chapter first', () => {
        const ranked = rankCompanionCandidates(chapters, 'how is tf-idf scoring computed?', 1);
        expect(ranked.length).toBe(1);
        expect(ranked[0].id).toBe('T1_Ch06_Scoring');
      });

      it('returns [] for short or stop-word-only queries (no wasted R2 reads)', () => {
        expect(rankCompanionCandidates(chapters, 'a', 1)).toEqual([]);
        expect(rankCompanionCandidates(chapters, 'and the', 1)).toEqual([]);
        expect(rankCompanionCandidates(chapters, '', 1)).toEqual([]);
        expect(rankCompanionCandidates([], 'scoring', 1)).toEqual([]);
      });

      it('respects the limit', () => {
        const ranked = rankCompanionCandidates(chapters, 'retrieval scoring evaluation', 1);
        expect(ranked.length).toBeLessThanOrEqual(1);
      });
    });

    describe('buildCompanionBlock', () => {
      it('returns empty for no snippets', () => {
        expect(buildCompanionBlock([])).toBe('');
      });

      it('caps chars and marks textbooks supplementary with distinct citation', () => {
        const block = buildCompanionBlock([
          { subject: 'IR', chapterId: 'T1_Ch01', title: 'Boolean Retrieval', book: 'T1', snippet: 'x'.repeat(4000) },
        ]);
        expect(block).toContain('TEXTBOOK SOURCES');
        expect(block).toContain('PRIMARY');
        expect(block).toContain('[Textbook: Boolean Retrieval]');
        expect(block.length).toBeLessThan(MAX_CHARS_PER_COMPANION + 1000);
      });
    });

    describe('getCompanionSnippets (fake R2 bucket via shim)', () => {
      const ch1Text = 'filler '.repeat(400) + 'boolean retrieval uses AND OR NOT operators ';
      const ch2Text = 'filler '.repeat(400) + 'tf-idf scoring weights rare terms higher ';
      const ch1Buf = Buffer.from(ch1Text, 'utf-8');
      const ch2Buf = Buffer.from(ch2Text, 'utf-8');
      const bundleBuf = Buffer.concat([ch1Buf, ch2Buf]);
      const chapters = [
        { id: 'ch1', title: 'Boolean Retrieval', book: 'T1', preview: 'boolean operators', offset: 0, length: ch1Buf.length },
        { id: 'ch2', title: 'Scoring', book: 'T1', preview: 'tf-idf scoring weights', offset: ch1Buf.length, length: ch2Buf.length },
      ];
      const fakeBucket = {
        get: async (key: string, opts?: any) => {
          if (key.endsWith('index.json')) {
            return { json: async () => ({ chapters }) };
          }
          if (key.endsWith('bundle.json')) {
            const offset = opts?.range?.offset ?? 0;
            const length = opts?.range?.length;
            const slice = bundleBuf.subarray(offset, length != null ? offset + length : undefined);
            return { text: async () => slice.toString('utf-8') };
          }
          return null;
        },
      };

      it('ranks the index, range-reads the winning chapter, and windows on the query', async () => {
        setTestEnv({ NOTES_BUCKET: fakeBucket });
        const snippets = await getCompanionSnippets({
          subject: 'Test Subject A',
          query: 'how is tf-idf scoring computed?',
        });
        expect(snippets.length).toBe(1);
        expect(snippets[0].chapterId).toBe('ch2');
        expect(snippets[0].title).toBe('Scoring');
        expect(snippets[0].snippet).toContain('tf-idf');
        expect(snippets[0].snippet.length).toBeLessThanOrEqual(MAX_CHARS_PER_COMPANION + 10);
      });

      it('returns [] for stop-word queries without touching R2', async () => {
        let calls = 0;
        setTestEnv({
          NOTES_BUCKET: {
            get: async () => {
              calls++;
              return null;
            },
          },
        });
        expect(await getCompanionSnippets({ subject: 'Test Subject B', query: 'and the' })).toEqual([]);
        expect(calls).toBe(0);
      });
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
