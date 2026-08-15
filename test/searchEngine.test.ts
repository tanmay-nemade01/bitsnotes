import { describe, it, expect } from 'vitest';
import {
  STOP_WORDS,
  prepareSearchIndex,
  tokenizeQuery,
  executeSearch,
  getSearchTitle,
  getSearchSnippet
} from '../src/utils/searchEngine';

describe('searchEngine', () => {
  const sampleItems = [
    {
      type: 'note',
      title: 'Introduction to Linear Regression and Supervised Learning',
      subject: 'Machine Learning',
      folderName: 'lecture_01',
      slug: 'lecture-01',
      topicTitle: 'Basics of Cost Function and Gradient Descent',
      text: 'Linear regression is a linear approach for modelling the relationship between a scalar response and one or more explanatory variables. If and then conditions in gradient descent determine convergence.'
    },
    {
      type: 'note',
      title: 'Deep Neural Networks and Convolutional Architectures',
      subject: 'Deep Learning',
      folderName: 'lecture_02',
      slug: 'lecture-02',
      topicTitle: 'Convolutional Filters and Pooling',
      text: 'Convolutional neural networks are specialized for processing data with a known grid-like topology. The forward pass computes feature maps.'
    },
    {
      type: 'blog',
      title: 'How to Study for BITS WILP Exams Effectively',
      subject: 'Blog',
      slug: 'bits-wilp-exam-guide',
      topicTitle: 'Exam Preparation Tips',
      text: 'Preparing for exams requires systematic revision of all lectures, quizzes, and assignments before the final week.'
    }
  ];

  const prepared = prepareSearchIndex(sampleItems as any);

  describe('tokenizeQuery & Stop Words', () => {
    it('identifies stop words like the, and, if, then', () => {
      expect(STOP_WORDS.has('the')).toBe(true);
      expect(STOP_WORDS.has('and')).toBe(true);
      expect(STOP_WORDS.has('if')).toBe(true);
      expect(STOP_WORDS.has('then')).toBe(true);
    });

    it('separates meaningful terms from stop words in mixed queries', () => {
      const { meaningfulTerms, stopWords, isPureStopWords } = tokenizeQuery('linear regression and classification');
      expect(meaningfulTerms).toEqual(['linear', 'regression', 'classification']);
      expect(stopWords).toEqual(['and']);
      expect(isPureStopWords).toBe(false);
    });

    it('detects pure stop word queries', () => {
      const { meaningfulTerms, isPureStopWords } = tokenizeQuery('if and then');
      expect(meaningfulTerms.length).toBe(0);
      expect(isPureStopWords).toBe(true);
    });
  });

  describe('executeSearch & Lazy Handling', () => {
    it('returns empty status for empty queries', () => {
      const res = executeSearch(prepared, '');
      expect(res.status).toBe('empty');
      expect(res.matches.length).toBe(0);
    });

    it('returns too_short status for 1-character queries without running heavy computation', () => {
      const res = executeSearch(prepared, 'h');
      expect(res.status).toBe('too_short');
      expect(res.matches.length).toBe(0);
    });

    it('searches successfully for 2+ character queries', () => {
      const res = executeSearch(prepared, 'linear');
      expect(res.status).toBe('ready');
      expect(res.matches.length).toBeGreaterThan(0);
      expect(res.matches[0].title).toContain('Linear Regression');
    });

    it('handles stop words gracefully without freezing or matching every document', () => {
      const res = executeSearch(prepared, 'linear regression and gradient descent');
      expect(res.status).toBe('ready');
      expect(res.matches.length).toBe(1);
      expect(res.matches[0].title).toContain('Linear Regression');
    });

    it('ranks exact title matches highest', () => {
      const res = executeSearch(prepared, 'Deep Neural Networks');
      expect(res.status).toBe('ready');
      expect(res.matches[0].title).toBe('Deep Neural Networks and Convolutional Architectures');
    });
  });

  describe('Highlighting & Snippet Generation', () => {
    it('highlights matched terms in title', () => {
      const highlighted = getSearchTitle('Introduction to Linear Regression', 'linear regression');
      expect(highlighted).toContain('<mark class="bg-[var(--accent-subtle)]');
      expect(highlighted).toContain('Linear');
      expect(highlighted).toContain('Regression');
    });

    it('generates small windowed snippet without full text dump', () => {
      const snippet = getSearchSnippet(
        'This is a very long text with lots of words before the key concept gradient descent and more words after.',
        'gradient descent'
      );
      expect(snippet).toContain('<mark class="bg-[var(--accent-subtle)]');
      expect(snippet).toContain('gradient');
    });
  });
});
