import { describe, it, expect } from 'vitest';
import {
  parseFolderLectureNumbers,
  detectResourceKind,
  getResourceKindLabel,
  formatLectureLabel,
  normalizeCatalogEntry,
  type RawCatalogEntry,
  slugify,
} from '../src/utils/lectureDisplay';
import type { DocumentMetadata } from '../src/utils/metadata';

describe('slugify', () => {
  it('converts titles to url-friendly slugs', () => {
    expect(slugify('Introduction to AI, History, Definitions, and Risks')).toBe(
      'introduction-to-ai-history-definitions-and-risks'
    );
    expect(slugify('MDP -> DP -> MC -> TD')).toBe('mdp-dp-mc-td');
    expect(slugify('  Hello   World!  ')).toBe('hello-world');
  });
});

function raw(partial: Partial<RawCatalogEntry> & { folderName: string; subject: string }): RawCatalogEntry {
  return {
    fileName: partial.folderName + '/notes.html',
    name: partial.folderName.replace(/_/g, ' '),
    ...partial,
  };
}

describe('parseFolderLectureNumbers', () => {
  it('parses Lecture_07', () => {
    expect(parseFolderLectureNumbers('Lecture_07')).toEqual({ start: 7 });
  });

  it('parses Lecture 7 (space)', () => {
    expect(parseFolderLectureNumbers('Lecture 7')).toEqual({ start: 7 });
  });

  it('parses Lecture07 (no separator)', () => {
    expect(parseFolderLectureNumbers('Lecture07')).toEqual({ start: 7 });
  });

  it('parses ranges with "and"', () => {
    expect(parseFolderLectureNumbers('Lecture_1_and_2')).toEqual({ start: 1, end: 2 });
    expect(parseFolderLectureNumbers('Lecture 1 and 2')).toEqual({ start: 1, end: 2 });
  });

  it('parses ranges with en-dash / hyphen', () => {
    expect(parseFolderLectureNumbers('Lecture 1-2')).toEqual({ start: 1, end: 2 });
    expect(parseFolderLectureNumbers('Lecture 1–2')).toEqual({ start: 1, end: 2 });
  });

  it('returns empty object when no number present', () => {
    expect(parseFolderLectureNumbers('Foundations')).toEqual({});
  });

  it('does NOT derive a number from a trailing index-like token', () => {
    // A folder like "Notes 3" should not be mistaken for lecture 3.
    expect(parseFolderLectureNumbers('Notes 3')).toEqual({});
  });
});

describe('detectResourceKind', () => {
  it('defaults to lecture', () => {
    expect(detectResourceKind('Lecture_07')).toBe('lecture');
  });

  it('detects solved-paper', () => {
    expect(detectResourceKind('NLP_Solved_Paper')).toBe('solved-paper');
  });

  it('detects one-sheet', () => {
    expect(detectResourceKind('NLP_One_Sheet')).toBe('one-sheet');
  });

  it('detects race-card', () => {
    expect(detectResourceKind('DRL_Race_Card')).toBe('race-card');
  });

  it('detects concept-map', () => {
    expect(detectResourceKind('ACI_Concept_Map')).toBe('concept-map');
  });

  it('prefers explicit metadata resourceKind', () => {
    const md = { resourceKind: 'worksheet' } as DocumentMetadata;
    expect(detectResourceKind('Lecture_07', md)).toBe('worksheet');
  });
});

describe('getResourceKindLabel', () => {
  it('maps kinds to human labels', () => {
    expect(getResourceKindLabel('lecture')).toBe('Lecture');
    expect(getResourceKindLabel('race-card')).toBe('Race Card');
    expect(getResourceKindLabel('one-sheet')).toBe('One Sheet');
  });
});

describe('formatLectureLabel', () => {
  it('formats a single lecture with padded number', () => {
    expect(formatLectureLabel({ lectureNumber: 7, topicTitle: 'POS Tagging and HMMs' }))
      .toBe('Lecture 07 · POS Tagging and HMMs');
  });

  it('formats a lecture range', () => {
    expect(formatLectureLabel({ lectureNumber: 1, lectureNumberEnd: 2, topicTitle: 'Foundations' }))
      .toBe('Lectures 01–02 · Foundations');
  });

  it('formats a non-lecture resource by kind', () => {
    expect(formatLectureLabel({ resourceKind: 'race-card', topicTitle: 'MDP → DP → MC → TD' }))
      .toBe('Race Card · MDP → DP → MC → TD');
  });

  it('falls back to topic only when no number', () => {
    expect(formatLectureLabel({ topicTitle: 'Foundations' })).toBe('Foundations');
  });
});

describe('normalizeCatalogEntry', () => {
  it('prefers metadata.lectureNumber over folder name', () => {
    const md = { lectureNumber: 12, topicTitle: 'Custom Title' } as DocumentMetadata;
    const entry = normalizeCatalogEntry(raw({ folderName: 'Lecture_07', metadata: md }));
    expect(entry.lectureNumber).toBe(12);
    expect(entry.topicTitle).toBe('Custom Title');
    expect(entry.displayTitle).toBe('Lecture 12 · Custom Title');
    expect(entry.slug).toBe('custom-title');
  });

  it('derives number from folder when metadata absent', () => {
    const entry = normalizeCatalogEntry(raw({ folderName: 'Lecture_03_Neural_Nets' }));
    expect(entry.lectureNumber).toBe(3);
    expect(entry.displayTitle).toBe('Lecture 03 · Neural Nets');
    expect(entry.slug).toBe('neural-nets');
  });

  it('marks fallback metadata and zeroes authored quiz count', () => {
    const md = {
      quiz: [{ question: 'q', options: ['a'], answerIndex: 0, explanation: 'e' }],
      metadataSource: 'fallback' as const,
    };
    const entry = normalizeCatalogEntry(raw({ folderName: 'Lecture_01', metadata: md }));
    expect(entry.metadataSource).toBe('fallback');
    expect(entry.authoredQuizCount).toBe(0);
    expect(entry.availableModes).not.toContain('quiz');
  });

  it('counts authored quizzes and exposes quiz mode', () => {
    const md = {
      quiz: [
        { question: 'q', options: ['a'], answerIndex: 0, explanation: 'e' },
        { question: 'q2', options: ['a'], answerIndex: 0, explanation: 'e' },
      ],
      metadataSource: 'companion' as const,
    };
    const entry = normalizeCatalogEntry(raw({ folderName: 'Lecture_01', metadata: md }));
    expect(entry.authoredQuizCount).toBe(2);
    expect(entry.availableModes).toContain('quiz');
  });

  it('sorts lectures before subject-level resources', () => {
    const lecture = normalizeCatalogEntry(raw({ folderName: 'Lecture_05' }));
    const race = normalizeCatalogEntry(raw({ folderName: 'DRL_Race_Card', metadata: { resourceKind: 'race-card', scope: 'subject' } as DocumentMetadata }));
    expect(lecture.sortOrder).toBeLessThan(race.sortOrder);
    expect(race.sortOrder).toBe(1000);
  });

  it('never produces a lecture number from a non-numeric folder', () => {
    const entry = normalizeCatalogEntry(raw({ folderName: 'Foundations_Overview' }));
    expect(entry.lectureNumber).toBeUndefined();
    expect(entry.resourceKind).toBe('lecture');
  });
});
