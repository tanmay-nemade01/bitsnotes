/**
 * R2 layout: Subject/Lecture/page_001.webp
 * Legacy flat folders: "Subject - Lecture 1/page_001.webp" at bucket root.
 */

export interface SubjectSummary {
  name: string;
  lectureCount: number;
}

export interface LectureSummary {
  name: string;
  /** Full R2 key prefix (no trailing slash) */
  r2Prefix: string;
}

/** e.g. "Deep Reinforcement Learning - Lecture 1" */
export function parseLegacyLectureFolder(folderName: string): { subject: string; lecture: string } | null {
  const match = folderName.match(/^(.+?)\s*-\s*(Lecture\b.+)$/i);
  if (!match) return null;
  return { subject: match[1].trim(), lecture: match[2].trim() };
}

function stripPrefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function lectureNameFromDelimitedPrefix(parentPrefix: string, delimited: string): string {
  return stripPrefix(delimited).replace(parentPrefix, '').replace(/\/$/, '');
}

/** Candidate R2 prefixes for a subject + lecture (new layout, then legacy). */
export function lecturePrefixCandidates(subject: string, lecture: string): string[] {
  const candidates = [`${subject}/${lecture}`, `${subject} - ${lecture}`];
  return [...new Set(candidates)];
}

export async function listSubjects(bucket: R2BucketLike): Promise<SubjectSummary[]> {
  const listed = await bucket.list({ delimiter: '/' });
  const topPrefixes: string[] = (listed.delimitedPrefixes || []).map(stripPrefix);

  const subjectLectures = new Map<string, Map<string, string>>();

  for (const topName of topPrefixes) {
    const subListed = await bucket.list({ prefix: `${topName}/`, delimiter: '/' });
    const lectureFolders = (subListed.delimitedPrefixes || []) as string[];

    if (lectureFolders.length > 0) {
      if (!subjectLectures.has(topName)) {
        subjectLectures.set(topName, new Map());
      }
      const lectures = subjectLectures.get(topName)!;
      for (const lf of lectureFolders) {
        const lectureName = lectureNameFromDelimitedPrefix(`${topName}/`, lf);
        if (lectureName) {
          lectures.set(lectureName, `${topName}/${lectureName}`);
        }
      }
      continue;
    }

    const legacy = parseLegacyLectureFolder(topName);
    if (legacy) {
      if (!subjectLectures.has(legacy.subject)) {
        subjectLectures.set(legacy.subject, new Map());
      }
      subjectLectures.get(legacy.subject)!.set(legacy.lecture, topName);
    }
  }

  return Array.from(subjectLectures.entries())
    .map(([name, lectures]) => ({ name, lectureCount: lectures.size }))
    .filter((s) => s.lectureCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLectures(bucket: R2BucketLike, subjectName: string): Promise<LectureSummary[]> {
  const listed = await bucket.list({ delimiter: '/' });
  const topPrefixes: string[] = (listed.delimitedPrefixes || []).map(stripPrefix);
  const lectures = new Map<string, string>();

  if (topPrefixes.includes(subjectName)) {
    const subListed = await bucket.list({ prefix: `${subjectName}/`, delimiter: '/' });
    for (const lf of (subListed.delimitedPrefixes || []) as string[]) {
      const lectureName = lectureNameFromDelimitedPrefix(`${subjectName}/`, lf);
      if (lectureName) {
        lectures.set(lectureName, `${subjectName}/${lectureName}`);
      }
    }
  }

  for (const topName of topPrefixes) {
    const legacy = parseLegacyLectureFolder(topName);
    if (legacy && legacy.subject === subjectName) {
      lectures.set(legacy.lecture, topName);
    }
  }

  return Array.from(lectures.entries())
    .map(([name, r2Prefix]) => ({ name, r2Prefix }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function resolveLecturePrefix(
  bucket: R2BucketLike,
  subjectName: string,
  lectureName: string
): Promise<string | null> {
  const lectures = await listLectures(bucket, subjectName);
  const match = lectures.find((l) => l.name === lectureName);
  if (match) return match.r2Prefix;

  for (const candidate of lecturePrefixCandidates(subjectName, lectureName)) {
    const listed = await bucket.list({ prefix: `${candidate}/`, limit: 1 });
    if ((listed.objects || []).length > 0) {
      return candidate;
    }
  }
  return null;
}

export type R2BucketLike = {
  list: (options: Record<string, unknown>) => Promise<{
    delimitedPrefixes?: string[];
    objects?: { key: string }[];
  }>;
};
