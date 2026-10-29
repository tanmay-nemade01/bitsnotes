import { describe, it, expect } from 'vitest';
import { setTestEnv } from './cloudflare-shim';
import {
  buildBaseSystemPrompt,
  buildCandidateText,
  buildCompanionBlock,
  buildCurrentLectureBlock,
  buildRelatedBlock,
  cleanHtmlToText,
  cleanPlainText,
  deriveChapterTitle,
  extractCurrentLectureChunks,
  getCurrentLectureContext,
  extractSnippetWindow,
  getCompanionSnippets,
  getLastUserQuery,
  hasCrossLectureIntent,
  hasTextbookIntent,
  MAX_CHARS_PER_COMPANION,
  MAX_CURRENT_LECTURE_CHARS,
  parseSubjectFromSystemPrompt,
  rankCandidates,
  rankCompanionCandidates,
  scoreSectionAgainstQuery,
  shouldRetrieveCompanion,
  shouldRetrieveRelated,
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
        expect(deriveChapterTitle('T1 _ Chapter 1 Introduction and Overview.txt')).toBe('Introduction and Overview');
        expect(deriveChapterTitle('T2 _ Appendix 1 Notes on Basic Probability Theory.txt')).toBe(
          'Appendix 1 Notes on Basic Probability Theory'
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

  describe('section-level chunking for current lecture', () => {
    const sampleMetadata = {
      summary: 'An in-depth study of cyclic redundancy checks and data integrity.',
      keyConcepts: ['CRC-32', 'Generator Polynomial', 'Parity Bit', 'Checksum'],
      sections: [
        {
          title: 'Section 1: Parity Bits and Simple Checksums',
          description: 'Basic single-bit parity checks and 16-bit internet checksum calculation.',
        },
        {
          title: 'Section 2: CRC-32 Error Detection',
          description: 'How CRC-32 divides binary bitstreams using generator polynomial 0x04C11DB7 for robust Ethernet frame verification.',
        },
        {
          title: 'Section 3: Hamming Codes and Forward Error Correction',
          description: 'Hamming distance (7,4) code matrix multiplication for single bit error correction.',
        },
      ],
    };

    const sampleHtml = `
      <div id="topic-content">
        <h1>Error Detection Techniques</h1>
        <p>In digital networks, CRC-32 is used for detecting burst transmission errors in Ethernet frames.</p>
        <p>Hamming codes provide single-bit error correction and double-bit error detection.</p>
      </div>
    `;

    it('scores relevant sections higher based on query terms', () => {
      const scoreCRC = scoreSectionAgainstQuery(sampleMetadata.sections[1], 'What is CRC-32 used for?');
      const scoreHamming = scoreSectionAgainstQuery(sampleMetadata.sections[2], 'What is CRC-32 used for?');
      expect(scoreCRC).toBeGreaterThan(scoreHamming);
      expect(scoreCRC).toBeGreaterThanOrEqual(20);
    });

    it('extracts top relevant section chunks and key concepts based on query', () => {
      const result = extractCurrentLectureChunks({
        metadata: sampleMetadata,
        htmlContent: sampleHtml,
        query: 'What is CRC-32 used for?',
      });

      expect(result.text).toContain('Overview:');
      expect(result.text).toContain('Key Concepts:');
      expect(result.text).toContain('CRC-32');
      expect(result.text).toContain('Section 2: CRC-32 Error Detection');
      expect(result.matchedSections).toContain('Section 2: CRC-32 Error Detection');
      expect(result.hasHighConfidenceMatch).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('enforces strict 4,000 character hard cap under massive input', () => {
      const hugeMetadata = {
        summary: 'Massive summary '.repeat(200),
        keyConcepts: Array.from({ length: 50 }, (_, i) => `Concept_${i}`),
        sections: [
          {
            title: 'Massive Section 1',
            description: 'Huge description '.repeat(500),
          },
          {
            title: 'Massive Section 2',
            description: 'Another huge description '.repeat(500),
          },
        ],
      };
      const hugeHtml = '<p>' + 'Very long text content with gradient descent '.repeat(1000) + '</p>';

      const result = extractCurrentLectureChunks({
        metadata: hugeMetadata,
        htmlContent: hugeHtml,
        query: 'gradient descent',
      });

      expect(result.text.length).toBeLessThanOrEqual(MAX_CURRENT_LECTURE_CHARS);
      expect(result.text.endsWith('…')).toBe(true);
    });

    it('handles missing metadata and empty queries gracefully', () => {
      const result = extractCurrentLectureChunks({
        metadata: null,
        htmlContent: '<p>Only html content here</p>',
        query: '',
      });
      expect(result.text).toBeDefined();
      expect(result.hasHighConfidenceMatch).toBe(false);
    });

    it('getCurrentLectureContext handles empty parameters or missing lectures non-fatally', async () => {
      const empty1 = await getCurrentLectureContext('', '', '');
      expect(empty1.text).toBe('');
      expect(empty1.hasHighConfidenceMatch).toBe(false);

      const empty2 = await getCurrentLectureContext({
        subject: 'NonExistentSubject',
        lectureFolder: 'NonExistentFolder',
        query: 'test query',
      });
      expect(empty2.text).toBe('');
      expect(empty2.hasHighConfidenceMatch).toBe(false);
    });
  });

  describe('intent gating for cross-lecture retrieval', () => {
    it('skips cross-lecture retrieval for specific single-lecture questions with high confidence', () => {
      const shouldRetrieve = shouldRetrieveRelated({
        query: 'What is CRC-32 used for?',
        hasHighConfidenceMatch: true,
      });
      expect(shouldRetrieve).toBe(false);
    });

    it('triggers cross-lecture retrieval when query includes comparative keywords (difference, compare, versus, vs)', () => {
      const diffQuery = shouldRetrieveRelated({
        query: 'What is the difference between CRC-32 and MD5?',
        hasHighConfidenceMatch: true,
      });
      expect(diffQuery).toBe(true);

      const compareQuery = shouldRetrieveRelated({
        query: 'Compare CRC-32 versus parity checksums',
        hasHighConfidenceMatch: true,
      });
      expect(compareQuery).toBe(true);

      const previousQuery = shouldRetrieveRelated({
        query: 'How does this relate to the previous lecture?',
        hasHighConfidenceMatch: true,
      });
      expect(previousQuery).toBe(true);
    });

    it('triggers cross-lecture retrieval when current lecture match confidence is low', () => {
      const shouldRetrieve = shouldRetrieveRelated({
        query: 'Explain B-Tree node splitting',
        hasHighConfidenceMatch: false,
      });
      expect(shouldRetrieve).toBe(true);
    });

    it('returns false for pure stop words or short queries', () => {
      expect(shouldRetrieveRelated({ query: 'a', hasHighConfidenceMatch: false })).toBe(false);
      expect(shouldRetrieveRelated({ query: 'the and or', hasHighConfidenceMatch: false })).toBe(false);
    });
  });

  describe('intent gating for textbook companion retrieval', () => {
    it('skips when includeTextbook is false', () => {
      expect(
        shouldRetrieveCompanion({
          query: 'give mathematical proof of CRC-32',
          includeTextbook: false,
          hasHighConfidenceMatch: true,
        })
      ).toBe(false);
    });

    it('triggers when query explicitly touches textbook concepts or proofs', () => {
      expect(
        shouldRetrieveCompanion({
          query: 'Provide the formal mathematical proof for this algorithm',
          includeTextbook: true,
          hasHighConfidenceMatch: true,
        })
      ).toBe(true);

      expect(
        shouldRetrieveCompanion({
          query: 'Can you give a textbook derivation of the formula?',
          includeTextbook: true,
          hasHighConfidenceMatch: true,
        })
      ).toBe(true);
    });

    it('triggers when current lecture context is sparse or lacks direct match', () => {
      expect(
        shouldRetrieveCompanion({
          query: 'What is CRC-32?',
          includeTextbook: true,
          hasHighConfidenceMatch: false,
          isLectureContextSparse: true,
        })
      ).toBe(true);
    });

    it('skips when lecture has high confidence match and no textbook intent', () => {
      expect(
        shouldRetrieveCompanion({
          query: 'What is CRC-32 used for?',
          includeTextbook: true,
          hasHighConfidenceMatch: true,
          isLectureContextSparse: false,
        })
      ).toBe(false);
    });
  });

  describe('lean system prompt builders', () => {
    it('buildBaseSystemPrompt produces lean prompt under ~1500 chars with exam tips and boundaries', () => {
      const prompt = buildBaseSystemPrompt('Data Warehousing');
      expect(prompt).toContain('Data Warehousing');
      expect(prompt).toContain('⚡ **Exam tip:**');
      expect(prompt).toContain('Strict Scope');
      expect(prompt).toContain('Formatting');
      expect(prompt.length).toBeLessThan(1500);
    });

    it('buildCurrentLectureBlock formats lecture context as primary ground truth', () => {
      const block = buildCurrentLectureBlock('DW', 'L6', 'Section 1 text');
      expect(block).toContain('CURRENT LECTURE CONTEXT (Primary Ground Truth)');
      expect(block).toContain('- Subject: "DW"');
      expect(block).toContain('- Lecture: "L6"');
      expect(block).toContain('Section 1 text');
    });
  });
});
