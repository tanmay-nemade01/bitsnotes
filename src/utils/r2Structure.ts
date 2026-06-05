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

export async function listSubjects(bucket: R2BucketLike, kv?: any): Promise<SubjectSummary[]> {
  const cacheKey = 'cache:subjects';
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error('KV cache read failed for listSubjects:', err);
    }
  }

  const listed = await bucket.list({ delimiter: '/' });
  const topPrefixes: string[] = (listed.delimitedPrefixes || []).map(stripPrefix);

  const subjectLectures = new Map<string, Map<string, string>>();

  // Query subfolders in parallel to avoid sequential N+1 network requests
  await Promise.all(
    topPrefixes.map(async (topName) => {
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
        return;
      }

      const legacy = parseLegacyLectureFolder(topName);
      if (legacy) {
        if (!subjectLectures.has(legacy.subject)) {
          subjectLectures.set(legacy.subject, new Map());
        }
        subjectLectures.get(legacy.subject)!.set(legacy.lecture, topName);
      }
    })
  );

  const result = Array.from(subjectLectures.entries())
    .map(([name, lectures]) => ({ name, lectureCount: lectures.size }))
    .filter((s) => s.lectureCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 }); // Cache for 24 hours
    } catch (err) {
      console.error('KV cache write failed for listSubjects:', err);
    }
  }

  return result;
}

export async function listLectures(
  bucket: R2BucketLike,
  subjectName: string,
  kv?: any
): Promise<LectureSummary[]> {
  const cacheKey = `cache:subject_lectures:${subjectName}`;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error(`KV cache read failed for listLectures (${subjectName}):`, err);
    }
  }

  // Run the two listing requests in parallel
  const [listed, subListed] = await Promise.all([
    bucket.list({ delimiter: '/' }),
    bucket.list({ prefix: `${subjectName}/`, delimiter: '/' })
  ]);

  const topPrefixes: string[] = (listed.delimitedPrefixes || []).map(stripPrefix);
  const lectures = new Map<string, string>();

  for (const lf of (subListed.delimitedPrefixes || []) as string[]) {
    const lectureName = lectureNameFromDelimitedPrefix(`${subjectName}/`, lf);
    if (lectureName) {
      lectures.set(lectureName, `${subjectName}/${lectureName}`);
    }
  }

  for (const topName of topPrefixes) {
    const legacy = parseLegacyLectureFolder(topName);
    if (legacy && legacy.subject === subjectName) {
      lectures.set(legacy.lecture, topName);
    }
  }

  const result = Array.from(lectures.entries())
    .map(([name, r2Prefix]) => ({ name, r2Prefix }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 }); // Cache for 24 hours
    } catch (err) {
      console.error(`KV cache write failed for listLectures (${subjectName}):`, err);
    }
  }

  return result;
}

export async function resolveLecturePrefix(
  bucket: R2BucketLike,
  subjectName: string,
  lectureName: string,
  kv?: any
): Promise<string | null> {
  // 1. Try the standard layout directly first
  const standard = `${subjectName}/${lectureName}`;
  let listed = await bucket.list({ prefix: `${standard}/`, limit: 1 });
  if ((listed.objects || []).length > 0) return standard;

  // 2. Try the legacy layout directly
  const legacy = `${subjectName} - ${lectureName}`;
  listed = await bucket.list({ prefix: `${legacy}/`, limit: 1 });
  if ((listed.objects || []).length > 0) return legacy;

  // 3. Fallback to full listings
  const lectures = await listLectures(bucket, subjectName, kv);
  const match = lectures.find((l) => l.name === lectureName);
  if (match) return match.r2Prefix;

  for (const candidate of lecturePrefixCandidates(subjectName, lectureName)) {
    const listedCandidate = await bucket.list({ prefix: `${candidate}/`, limit: 1 });
    if ((listedCandidate.objects || []).length > 0) {
      return candidate;
    }
  }
  return null;
}

export async function invalidateCache(kv: any, key: string): Promise<void> {
  if (!kv) return;
  try {
    // Invalidate main subjects list
    await kv.delete('cache:subjects');

    // Parse out the subject name from R2 key to invalidate subject lectures
    // Format: "SubjectName/LectureName/page_001.webp" or "SubjectName - LectureName/page_001.webp"
    const parts = key.split('/');
    if (parts.length >= 1) {
      const topName = parts[0];
      await kv.delete(`cache:subject_lectures:${topName}`);

      const legacy = parseLegacyLectureFolder(topName);
      if (legacy) {
        await kv.delete(`cache:subject_lectures:${legacy.subject}`);
      }
    }
  } catch (error) {
    console.error(`Failed to invalidate cache for key "${key}":`, error);
  }
}

export async function invalidateAllCaches(kv: any): Promise<void> {
  if (!kv) return;
  try {
    let truncated = true;
    let cursor: string | undefined = undefined;
    
    while (truncated) {
      const options: any = { prefix: 'cache:', limit: 100 };
      if (cursor) {
        options.cursor = cursor;
      }
      
      const listed = await kv.list(options);
      if (listed.keys && listed.keys.length > 0) {
        await Promise.all(listed.keys.map((k: any) => kv.delete(k.name)));
      }
      
      truncated = listed.truncated;
      cursor = listed.cursor;
    }
  } catch (error) {
    console.error('Failed to invalidate all caches:', error);
  }
}

export type R2BucketLike = {
  list: (options: Record<string, unknown>) => Promise<{
    delimitedPrefixes?: string[];
    objects?: { key: string }[];
  }>;
};
