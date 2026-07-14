import { describe, it, expect } from 'vitest';
import { splitLectureTopics } from '../src/utils/topicSplitter';

describe('splitLectureTopics', () => {
  it('handles zero topics and returns fallback full lecture', () => {
    const html = '<p>Just normal text without headings</p>';
    const result = splitLectureTopics(html);
    expect(result.hasMultipleTopics).toBe(false);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].id).toBe('full');
    expect(result.topics[0].title).toBe('Full lecture');
    expect(result.topics[0].html).toBe(html);
  });

  it('splits sections based on h2.section-title or number prefix', () => {
    const html = `
      <h2 class="section-title">9.1 Intro to NLP</h2>
      <p>NLP is cool</p>
      <h2>9.2 Vector Spaces</h2>
      <p>Vectors are cool</p>
    `;
    const result = splitLectureTopics(html);
    expect(result.hasMultipleTopics).toBe(true);
    expect(result.topics).toHaveLength(2);

    expect(result.topics[0].id).toBe('9.1');
    expect(result.topics[0].title).toBe('9.1 Intro to NLP');
    expect(result.topics[0].html).toContain('NLP is cool');

    expect(result.topics[1].id).toBe('9.2');
    expect(result.topics[1].title).toBe('9.2 Vector Spaces');
    expect(result.topics[1].html).toContain('Vectors are cool');
  });

  it('extracts h3 subtopics within each topic chunk', () => {
    const html = `
      <h2 class="section-title">9.1 Title</h2>
      <h3 class="subsection-title">9.1.1 Subtitle</h3>
      <p>Content</p>
      <h3>9.1.2 Another Subtitle</h3>
    `;
    const result = splitLectureTopics(html);
    expect(result.topics[0].subtopics).toHaveLength(2);
    expect(result.topics[0].subtopics[0].title).toBe('9.1.1 Subtitle');
    expect(result.topics[0].subtopics[1].title).toBe('9.1.2 Another Subtitle');
  });

  it('handles non-trivial preambles by generating Overview topic', () => {
    const html = `
      <p>Non-trivial preamble content about NLP</p>
      <h2 class="section-title">9.1 Lecture Notes</h2>
    `;
    const result = splitLectureTopics(html);
    expect(result.topics).toHaveLength(2);
    expect(result.topics[0].id).toBe('overview');
    expect(result.topics[0].title).toBe('Overview');
    expect(result.topics[0].html).toContain('Non-trivial preamble');
  });

  it('prepends trivial preambles to the first topic', () => {
    const html = `
      <!-- empty or comment trivial preamble -->
      <h2 class="section-title">9.1 Lecture Notes</h2>
      <p>First topic content</p>
    `;
    const result = splitLectureTopics(html);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].id).toBe('9.1');
    expect(result.topics[0].html).toContain('trivial preamble');
  });

  it('strips leading style tags and preserves style tags not at the start', () => {
    const html = `<style>.x { color: red; }</style><h2 class="section-title">9.1 Topic</h2>`;
    const result = splitLectureTopics(html);
    expect(result.topics[0].html).toBe('<h2 class="section-title">9.1 Topic</h2>');
  });

  it('treats a preamble containing only a header block as trivial', () => {
    const html = `
      <header class="hero-header">
        <h1>Introduction to AI</h1>
        <p>Published: June 2, 2026</p>
      </header>
      <h2 class="section-title">1.1 Course Overview</h2>
      <p>Content of first section</p>
    `;
    const result = splitLectureTopics(html);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].id).toBe('1.1');
    expect(result.topics[0].html).toContain('Introduction to AI');
    expect(result.topics[0].html).toContain('Content of first section');
  });
});
