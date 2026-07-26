export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface SectionBreakdown {
  title: string;
  pages: string;
  description: string;
}

export interface ExamRevisionItem {
  topic: string;
  mustKnow: string;
  keyFormula?: string;
  commonPitfall?: string;
  quickCheck?: string;
  connections?: string[];
}

/** Controlled vocabulary for the kind of catalog resource a folder represents. */
export type ResourceKind =
  | 'lecture'
  | 'solved-paper'
  | 'one-sheet'
  | 'worksheet'
  | 'question-bank'
  | 'concept-map'
  | 'race-card';

/** The ways a resource can be consumed in the viewer. */
export type AvailableMode = 'notes' | 'study-guide' | 'exam-revision' | 'quiz';

/** Where the metadata came from — drives whether quiz/revision counts are "authored". */
export type MetadataSource = 'companion' | 'embedded' | 'fallback';

/** Scope of the resource: a single lecture, or a subject-level cross-lecture resource. */
export type ResourceScope = 'lecture' | 'subject';

export interface DocumentMetadata {
  title: string;
  subject: string;
  gradeLevel: string;
  datePublished: string;
  summary: string;
  targetAudience: string;
  keyConcepts: string[];
  sections: SectionBreakdown[];
  quiz: QuizQuestion[];
  examRevisionNotes?: ExamRevisionItem[];
  pageTranscripts?: string[];

  /** Explicit slug override. */
  slug?: string;
  /** Human topic title, preferred over the raw filename. */
  topicTitle?: string;
  /** Parsed lecture number (never derived from array index). */
  lectureNumber?: number;
  /** End of a lecture range, e.g. 1–2. */
  lectureNumberEnd?: number;
  /** Controlled resource kind (see ResourceKind). */
  resourceKind?: ResourceKind;
  /** Modes available in the viewer for this resource. */
  availableModes?: AvailableMode[];
  /** lecture | subject. */
  scope?: ResourceScope;
  /** Stable sort key within a subject. */
  sortOrder?: number;
  /** Short card/list blurb. */
  shortDescription?: string;
  /** Optional topic tags. */
  topics?: string[];
  /** Provenance of the metadata — distinguishes authored vs generated. */
  metadataSource?: MetadataSource;
}

export function getFallbackMetadata(lectureName: string, subjectName?: string): DocumentMetadata {
  // Parse structured document ID: "Subject - DocumentName"
  let subject = subjectName || "General Course Notes";
  let displayTitle = lectureName;
  
  const parts = lectureName.split(" - ");
  if (parts.length >= 2) {
    subject = parts[0].trim();
    displayTitle = parts.slice(1).join(" - ").trim();
  }

  // Capitalize displayTitle nicely if it matches "lectureX" or "lecture_X" or "lecture-X"
  let readableTitle = displayTitle;
  if (/^lecture[\s_-]*\d+$/i.test(displayTitle)) {
    const num = displayTitle.match(/\d+/)?.[0];
    readableTitle = `Lecture ${num}`;
  } else {
    // Basic capitalization of first letter
    readableTitle = displayTitle.charAt(0).toUpperCase() + displayTitle.slice(1);
  }

  const formattedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return {
    title: readableTitle,
    subject: subject,
    gradeLevel: "High School / Undergraduate",
    datePublished: formattedDate,
    targetAudience: `Students studying ${readableTitle} under the ${subject} curriculum who are looking for clear explanations, conceptual breakdowns, and interactive review questions to master the course material.`,
    // Phase 2: mark fallback metadata so quiz/revision counts are not treated as authored.
    resourceKind: "lecture",
    scope: "lecture",
    metadataSource: "fallback",
    summary: `This comprehensive study guide covers the essential concepts, equations, and methodologies presented in the ${subject} document '${readableTitle}'. It outlines key terms, explains standard problem-solving strategies, and presents structured notes to aid in retention. The guide is designed to highlight the core themes of ${subject}, bridge theoretical formulas with practical examples, and provide a self-assessment path for students preparing for assignments and examinations in this subject area.`,
    keyConcepts: [
      `Understand the key definitions, terminology, and course context of ${subject}.`,
      `Analyze the core mechanisms, models, and equations introduced in the ${readableTitle} notes.`,
      `Apply the concepts of ${subject} to solve standard exercises and review step-by-step solutions.`,
      "Synthesize theoretical ideas to build a comprehensive framework of the lecture material."
    ],
    sections: [
      {
        title: "Section 1: Foundations and Background",
        pages: "Pages 1-2",
        description: `Overview of basic ${subject} concepts, introduction to key terminology, and setting the academic context.`
      },
      {
        title: "Section 2: Core Analysis and Methodology",
        pages: "Pages 3-5",
        description: `Detailed walk-through of the main methodologies, mathematical equations, or theories proposed in ${readableTitle}.`
      },
      {
        title: "Section 3: Practical Applications and Exercises",
        pages: "Pages 6-8",
        description: "Examples of applying the theory to practical problems, accompanied by step-by-step guidance."
      }
    ],
    quiz: [
      {
        question: `What is the primary academic focus of the ${subject} document '${readableTitle}'?`,
        options: [
          "To provide a structured review of core concepts and their applications.",
          "To present unrelated historical anecdotes.",
          "To serve as a generic blank template.",
          "To discuss advanced research topics outside the standard curriculum."
        ],
        answerIndex: 0,
        explanation: `The primary objective of '${readableTitle}' is to break down the core curriculum concepts of ${subject} and illustrate their practical applications.`
      },
      {
        question: "How are the sections in this study guide organized to aid learning?",
        options: [
          "They are sorted randomly.",
          "They progress from basic foundations, through detailed methodology, to practical exercises and applications.",
          "They only present questions without answers.",
          "They cover advanced theoretical topics without basic context."
        ],
        answerIndex: 1,
        explanation: "The guide is logically structured to build understanding progressively, starting with foundational definitions before moving to complex theories and practice problems."
      },
      {
        question: `Which of the following describes the correct approach to using these ${subject} notes?`,
        options: [
          "Memorizing text word-for-word without understanding details.",
          "Skipping summaries and only viewing the final page.",
          "Reading the crawlable overview, checking key concepts, reviewing the sections, and taking the practice quiz to verify understanding.",
          "Attempting to download the flat images to print them out."
        ],
        answerIndex: 2,
        explanation: "The best learning outcome is achieved by reading the summary context, focusing on the core learning objectives, and using the practice quiz at the bottom for active recall."
      }
    ],
    pageTranscripts: []
  };
}
