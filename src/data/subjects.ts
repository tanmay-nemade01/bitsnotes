/**
 * subjects.ts
 *
 * Phase 2.4 — Subject catalog metadata.
 *
 * Each subject folder under `src/content/notes/` should have an entry here
 * with a canonical name, a short display name, a one-sentence description,
 * and an optional ordering / course code.
 *
 * If a content folder has no entry, `getSubjectInfo()` returns a neutral
 * fallback and logs a dev warning so the gap can be filled in.
 */

export interface SubjectInfo {
  /** Canonical name — MUST match the content folder name exactly. */
  name: string;
  /** Short label used in tight UI (nav, chips). */
  shortName: string;
  /** One-sentence description shown on home + subject pages. */
  description: string;
  /** Optional display order (lower = earlier). */
  order?: number;
  /** Optional course code. */
  code?: string;
}

export const SUBJECTS: SubjectInfo[] = [
  {
    name: 'Artificial Computational Intelligence',
    shortName: 'ACI',
    description:
      'Foundations of intelligent agents, search, knowledge representation, and reasoning under uncertainty.',
    order: 1,
    code: 'ACI',
  },
  {
    name: 'Data Management for Machine Learning',
    shortName: 'DMML',
    description:
      'How data is stored, cleaned, versioned, and served to power reliable machine-learning pipelines.',
    order: 2,
    code: 'DMML',
  },
  {
    name: 'Deep Neural Networks',
    shortName: 'DNN',
    description:
      'Architectures, training dynamics, and optimization behind modern deep learning models.',
    order: 3,
    code: 'DNN',
  },
  {
    name: 'Deep Reinforcement Learning',
    shortName: 'DRL',
    description:
      'Agents that learn from reward through value methods, policy gradients, and exploration strategies.',
    order: 4,
    code: 'DRL',
  },
  {
    name: 'Introduction to Statistical Methods',
    shortName: 'ISM',
    description:
      'Probability, estimation, and inference that underpin every quantitative ML technique.',
    order: 5,
    code: 'ISM',
  },
  {
    name: 'Machine Learning',
    shortName: 'ML',
    description:
      'Core supervised and unsupervised learning algorithms, model selection, and evaluation.',
    order: 6,
    code: 'ML',
  },
  {
    name: 'Mathematical Foundations for Machine Learning',
    shortName: 'Math Fdn',
    description:
      'Linear algebra, calculus, and probability you need to read ML papers with confidence.',
    order: 7,
    code: 'MFML',
  },
  {
    name: 'Natural Language Processing',
    shortName: 'NLP',
    description:
      'From linguistic structure to modern sequence models for understanding and generating text.',
    order: 8,
    code: 'NLP',
  },
  {
    name: 'Software Engineering for Machine Learning',
    shortName: 'SEML',
    description:
      'Engineering practices, testing, and MLOps that take models from notebook to production.',
    order: 9,
    code: 'SEML',
  },
];

const SUBJECT_MAP = new Map(SUBJECTS.map((s) => [s.name, s]));

/** Neutral fallback used when a content folder has no curated entry. */
function fallbackSubject(name: string): SubjectInfo {
  if (import.meta.env.DEV) {
    console.warn(
      `[subjects] No curated entry for content folder "${name}". ` +
        `Add it to src/data/subjects.ts for a proper description.`,
    );
  }
  return {
    name,
    shortName: name,
    description: 'Lecture notes and study resources for this subject.',
  };
}

export function getSubjectInfo(name: string): SubjectInfo {
  return SUBJECT_MAP.get(name) ?? fallbackSubject(name);
}

/** Subjects sorted by their declared order (stable). */
export function getOrderedSubjects(): SubjectInfo[] {
  return [...SUBJECTS].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
