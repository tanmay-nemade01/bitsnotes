import { env } from 'cloudflare:workers';
import { getFallbackMetadata } from './metadata';
import type { DocumentMetadata, ResourceKind, AvailableMode, ResourceScope, MetadataSource } from './metadata';
import { normalizeCatalogEntry, type RawCatalogEntry } from './lectureDisplay';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubjectSummary {
  name: string;
  lectureCount: number;
}

export interface LectureSummary {
  name: string;
  folderName: string;
}

export interface LectureContent {
  htmlContent: string;
  metadata: Record<string, any> | null;
  fileName: string;
}

/** A catalog entry carried in the manifest — enough to render without fetching HTML. */
export interface CatalogLecture {
  name: string;
  folderName: string;
  fileName: string;
  topicTitle: string;
  displayTitle: string;
  lectureNumber?: number;
  lectureNumberEnd?: number;
  resourceKind: ResourceKind;
  availableModes: AvailableMode[];
  scope: ResourceScope;
  sortOrder: number;
  shortDescription?: string;
  topics?: string[];
  metadataSource: MetadataSource;
  authoredQuizCount: number;
}

interface LectureEntry {
  name: string;
  folderName: string;
  fileName: string;
  metadata: any;
}

interface SubjectEntry {
  name: string;
  lectureCount: number;
  lectures: LectureEntry[];
}

interface NotesManifest {
  version: string;
  subjects_count: number;
  total_lectures: number;
  updatedAt: string;
  subjects: SubjectEntry[];
}

// ─── Vite Glob Imports for local development ─────────────────────────────────
// This allows loading notes in the dev environment without node:fs, which fails
// inside the sandboxed Cloudflare workerd runtime.
const htmlFiles = import.meta.env.DEV
  ? import.meta.glob('/src/content/notes/**/*.html', { query: '?raw', import: 'default' })
  : {};

const jsonFiles = import.meta.env.DEV
  ? import.meta.glob('/src/content/notes/**/*.json', { import: 'default' })
  : {};


// ─── Shared Helpers ──────────────────────────────────────────────────────────

function extractEmbeddedMetadata(htmlContent: string): Record<string, any> | null {
  const match = htmlContent.match(
    /<script\s+[^>]*id=["']lecture-metadata["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// ─── Manifest Fetching with TTL Cache ───────────────────────────────────────

let manifestCache: NotesManifest | null = null;
let lastFetchedTime = 0;

let devManifestCache: NotesManifest | null = null;
let devLastFetchedTime = 0;

export async function getManifest(): Promise<NotesManifest> {
  const now = Date.now();

  // Development: scan local filesystem
  if (import.meta.env.DEV) {
    if (devManifestCache && (now - devLastFetchedTime < 2000)) {
      return devManifestCache;
    }
    const manifest = await buildLocalManifest();
    devManifestCache = manifest;
    devLastFetchedTime = now;
    return manifest;
  }

  // Production: fetch from R2 with 10-second in-memory TTL cache, backed by
  // the Cloudflare Cache API for a longer (5 min) isolate-level TTL with
  // stale-while-revalidate (Phase 8.8). Versioned by the manifest's own
  // `version` field so a new upload invalidates the cached copy immediately.
  if (manifestCache && (now - lastFetchedTime < 10000)) {
    return manifestCache;
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[notesLoader] NOTES_BUCKET binding not found. Ensure wrangler.jsonc contains the R2 binding.');
    return { version: 'empty', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
  }

  try {
    const cache = (env as any).caches?.default as Cache | undefined;
    const cacheKey = new Request('https://internal.bitsnotes/cache/notes-manifest.json');
    let obj = await bucket.get('notes-manifest.json');
    if (!obj) {
      console.warn('[notesLoader] notes-manifest.json not found in R2 bucket.');
      return { version: 'empty', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
    }
    const manifest = (await obj.json()) as NotesManifest;

    // Populate the edge cache with a 5-minute TTL, versioned by manifest version.
    if (cache) {
      try {
        const cached = new Response(JSON.stringify(manifest), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'ETag': `"${manifest.version}"`,
          },
        });
        // Fire-and-forget cache write (best-effort).
        cache.put(cacheKey, cached).catch(() => {});
      } catch { /* cache write is best-effort */ }
    }

    manifestCache = manifest;
    lastFetchedTime = now;
    return manifest;
  } catch (err: any) {
    console.error('[notesLoader] Error fetching notes-manifest.json from R2:', err.message);
    return { version: 'error', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
  }
}

// Scans local notes directory and builds in-memory manifest for development
async function buildLocalManifest(): Promise<NotesManifest> {
  const subjectsMap = new Map<string, LectureEntry[]>();
  let totalLectures = 0;

  for (const key of Object.keys(htmlFiles)) {
    // Key format: /src/content/notes/Subject Name/Lecture Folder/File Name.html
    const match = key.match(/^\/src\/content\/notes\/([^\/]+)\/([^\/]+)\/([^\/]+)\.html$/);
    if (!match) continue;

    const subjectName = match[1];
    const lectureFolder = match[2];
    const fileName = match[3];

    const defaultDisplayName = fileName.replace(/_/g, ' ');

    // Look for companion JSON
    const jsonKey = `/src/content/notes/${subjectName}/${lectureFolder}/${fileName}.json`;
    let metadata = null;
    if (jsonFiles[jsonKey]) {
      try {
        metadata = await jsonFiles[jsonKey]() as any;
      } catch (err: any) {
        console.error(`[notesLoader] Error loading local json for ${subjectName}/${lectureFolder}:`, err.message);
      }
    }

    if (!metadata) {
      try {
        const htmlContent = await htmlFiles[key]() as string;
        metadata = extractEmbeddedMetadata(htmlContent);
      } catch (err: any) {
        console.error(`[notesLoader] Error loading local html for ${subjectName}/${lectureFolder}:`, err.message);
      }
    }

    if (!metadata) {
      metadata = getFallbackMetadata(defaultDisplayName, subjectName);
    }

    const displayName = defaultDisplayName;

    if (!subjectsMap.has(subjectName)) {
      subjectsMap.set(subjectName, []);
    }

    subjectsMap.get(subjectName)!.push({
      name: displayName,
      folderName: lectureFolder,
      fileName: fileName,
      metadata: metadata
    });

    totalLectures++;
  }

  const subjectsList: SubjectEntry[] = [];
  for (const [subjectName, lecturesList] of subjectsMap.entries()) {
    // Normalize each entry into a catalog entry and sort by its stable sortOrder
    // (which is derived from the real lecture number, never an array index).
    const catalogLectures = lecturesList
      .map((lec) => {
        const raw: RawCatalogEntry = {
          subject: subjectName,
          folderName: lec.folderName,
          fileName: lec.fileName,
          name: lec.name,
          metadata: lec.metadata as DocumentMetadata | null,
        };
        // Keep the normalized catalog fields AND the raw metadata so that
        // getLectureContent() can return the original metadata (scope,
        // resourceKind, topicTitle, summary, quiz, etc.) to the viewer.
        return { ...normalizeCatalogEntry(raw), metadata: lec.metadata };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayTitle.localeCompare(b.displayTitle));

    subjectsList.push({
      name: subjectName,
      lectureCount: catalogLectures.length,
      lectures: catalogLectures as unknown as LectureEntry[]
    });
  }

  subjectsList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: 'dev-manifest',
    subjects_count: subjectsList.length,
    total_lectures: totalLectures,
    updatedAt: new Date().toISOString(),
    subjects: subjectsList
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** List all subjects with their lecture counts. */
export async function listSubjects(): Promise<SubjectSummary[]> {
  const manifest = await getManifest();
  return manifest.subjects.map(s => ({
    name: s.name,
    lectureCount: s.lectureCount
  }));
}

/** List all lectures within a subject, as normalized catalog entries. */
export async function listLectures(subjectName: string): Promise<CatalogLecture[]> {
  const manifest = await getManifest();
  const subject = manifest.subjects.find(s => s.name === subjectName);
  if (!subject) return [];
  return subject.lectures.map((l: any) => ({
    name: l.name,
    folderName: l.folderName,
    fileName: l.fileName,
    topicTitle: l.topicTitle,
    displayTitle: l.displayTitle,
    lectureNumber: l.lectureNumber,
    lectureNumberEnd: l.lectureNumberEnd,
    resourceKind: l.resourceKind,
    availableModes: l.availableModes,
    scope: l.scope,
    sortOrder: l.sortOrder,
    shortDescription: l.shortDescription,
    topics: l.topics,
    metadataSource: l.metadataSource,
    authoredQuizCount: l.authoredQuizCount,
  }));
}

/**
 * Phase 2.5 — Return the full catalog (all subjects + their normalized
 * resources) in a single manifest read. Prefer this over repeated
 * `listSubjects()` + `listLectures()` calls.
 */
export async function listCatalog(): Promise<Array<{ subject: string; lectureCount: number; lectures: CatalogLecture[] }>> {
  const manifest = await getManifest();
  return manifest.subjects.map((s) => ({
    subject: s.name,
    lectureCount: s.lectureCount,
    lectures: s.lectures.map((l: any) => ({
      name: l.name,
      folderName: l.folderName,
      fileName: l.fileName,
      topicTitle: l.topicTitle,
      displayTitle: l.displayTitle,
      lectureNumber: l.lectureNumber,
      lectureNumberEnd: l.lectureNumberEnd,
      resourceKind: l.resourceKind,
      availableModes: l.availableModes,
      scope: l.scope,
      sortOrder: l.sortOrder,
      shortDescription: l.shortDescription,
      topics: l.topics,
      metadataSource: l.metadataSource,
      authoredQuizCount: l.authoredQuizCount,
    })),
  }));
}

/** Phase 2.5 — Alias of `listLectures` for subject-scoped catalog access. */
export async function listSubjectResources(subjectName: string): Promise<CatalogLecture[]> {
  return listLectures(subjectName);
}

/** Phase 2.5 — Real library statistics derived from the catalog (no view counters). */
export interface LibraryStats {
  subjects: number;
  lectures: number;
  authoredQuizQuestions: number;
  examRevisionResources: number;
  additionalResources: number;
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const catalog = await listCatalog();
  let lectures = 0;
  let authoredQuizQuestions = 0;
  let examRevisionResources = 0;
  let additionalResources = 0;

  for (const subject of catalog) {
    for (const lec of subject.lectures) {
      if (lec.scope === 'lecture') {
        lectures++;
      } else {
        additionalResources++;
      }
      authoredQuizQuestions += lec.authoredQuizCount;
      if (lec.availableModes.includes('exam-revision')) {
        examRevisionResources++;
      }
    }
  }

  return {
    subjects: catalog.length,
    lectures,
    authoredQuizQuestions,
    examRevisionResources,
    additionalResources,
  };
}

/** Get the full HTML content and metadata for a specific lecture. */
export async function getLectureContent(subjectName: string, lectureFolderName: string): Promise<LectureContent | null> {
  const manifest = await getManifest();
  const subject = manifest.subjects.find(s => s.name === subjectName);
  if (!subject) return null;

  const lecture = subject.lectures.find(l => l.folderName === lectureFolderName);
  if (!lecture) return null;

  let htmlContent = '';
  
  if (import.meta.env.DEV) {
    // Development: load using Vite glob import
    try {
      const key = `/src/content/notes/${subjectName}/${lectureFolderName}/${lecture.fileName}.html`;
      if (htmlFiles[key]) {
        htmlContent = await htmlFiles[key]() as string;
      } else {
        console.error(`[notesLoader] Local file not found in glob: ${key}`);
        return null;
      }
    } catch (err: any) {
      console.error(`[notesLoader] Error reading local note: ${err.message}`);
      return null;
    }
  } else {
    // Production: fetch HTML file from Cloudflare R2
    const bucket = (env as any).NOTES_BUCKET;
    if (!bucket) {
      console.error('[notesLoader] NOTES_BUCKET binding not found in production.');
      return null;
    }

    const key = `notes/${subjectName}/${lectureFolderName}/${lecture.fileName}.html`;
    try {
      const obj = await bucket.get(key);
      if (!obj) {
        console.warn(`[notesLoader] R2 Object not found: ${key}`);
        return null;
      }
      htmlContent = await obj.text();

      // Cache the lecture HTML at the edge, versioned by the manifest version
      // so a new content upload invalidates it (Phase 8.8). No unbounded
      // in-memory map — rely on the Cache API instead.
      const cache = (env as any).caches?.default as Cache | undefined;
      if (cache) {
        try {
          const cacheKey = new Request(`https://internal.bitsnotes/cache/lecture/${subjectName}/${lectureFolderName}`);
          const cached = new Response(htmlContent, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
              'ETag': `"${manifest.version}"`,
            },
          });
          cache.put(cacheKey, cached).catch(() => {});
        } catch { /* best-effort */ }
      }
    } catch (err: any) {
      console.error(`[notesLoader] Error fetching note from R2 (${key}):`, err.message);
      return null;
    }
  }

  return {
    htmlContent,
    metadata: lecture.metadata,
    fileName: lecture.fileName
  };
}

/**
 * Resolve a lecture display name back to a folder name.
 * Used when URL params use the display name and we need the folder.
 */
export async function resolveLectureFolderName(subjectName: string, lectureDisplayName: string): Promise<string | null> {
  const lectures = await listLectures(subjectName);

  // Direct match by display name
  const byName = lectures.find((l) => l.name === lectureDisplayName);
  if (byName) return byName.folderName;

  // Direct match by folder name (user might have used folder name in URL)
  const byFolder = lectures.find((l) => l.folderName === lectureDisplayName);
  if (byFolder) return byFolder.folderName;

  return null;
}

/** Legacy redirect parser (kept for backward compatibility with old /view/[id] URLs). */
export function parseLegacyLectureFolder(folderName: string): { subject: string; lecture: string } | null {
  const match = folderName.match(/^(.+?)\s*-\s*(Lecture\b.+)$/i);
  if (!match) return null;
  return { subject: match[1].trim(), lecture: match[2].trim() };
}
