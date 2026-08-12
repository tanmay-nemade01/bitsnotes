import { env } from 'cloudflare:workers';
import { getFallbackMetadata } from './metadata';
import type { DocumentMetadata, ResourceKind, AvailableMode, ResourceScope, MetadataSource } from './metadata';
import { normalizeCatalogEntry, type RawCatalogEntry, slugify } from './lectureDisplay';

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
  cssContent?: string;
  jsContent?: string;
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
  slug: string;
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
  htmlContent?: string | null;
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
// Standard lazy glob imports. HTML files are loaded on-demand per lecture view,
// keeping server startup and catalog builds lightning-fast (<10ms).
const htmlFiles = import.meta.env.DEV
  ? (import.meta.glob('/src/content/notes/**/*.html', { query: '?raw', import: 'default' }) as Record<string, any>)
  : {};

const cssFiles = import.meta.env.DEV
  ? (import.meta.glob('/src/content/notes/**/*.css', { query: '?raw', import: 'default' }) as Record<string, any>)
  : {};

const jsFiles = import.meta.env.DEV
  ? (import.meta.glob('/src/content/notes/**/*.js', { query: '?raw', import: 'default' }) as Record<string, any>)
  : {};

const jsonFiles = import.meta.env.DEV
  ? (import.meta.glob('/src/content/notes/**/*.json', { import: 'default' }) as Record<string, any>)
  : {};

async function resolveGlobEntry<T = string>(entry: any): Promise<T | null> {
  if (!entry) return null;
  if (typeof entry === 'function') {
    return (await entry()) as T;
  }
  return entry as T;
}



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

  // Development: scan local filesystem (cached for 5 min in dev; rebuilding
  // reads every lecture HTML through the workerd→vite bridge, so only pay
  // that cost when note files have actually been added/removed).
  if (import.meta.env.DEV) {
    if (devManifestCache && (now - devLastFetchedTime < 300000)) {
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

  // Group html files by lecture folder to prefer _notes_enhanced.html if present
  const folderEntriesMap = new Map<string, Array<{ key: string; subjectName: string; lectureFolder: string; fileName: string }>>();

  for (const key of Object.keys(htmlFiles)) {
    // Key format: /src/content/notes/Subject Name/Lecture Folder/File Name.html
    const match = key.match(/^\/src\/content\/notes\/([^\/]+)\/([^\/]+)\/([^\/]+)\.html$/);
    if (!match) continue;

    const subjectName = match[1];
    const lectureFolder = match[2];
    const fileName = match[3];

    const folderKey = `${subjectName}/${lectureFolder}`;
    if (!folderEntriesMap.has(folderKey)) {
      folderEntriesMap.set(folderKey, []);
    }
    folderEntriesMap.get(folderKey)!.push({ key, subjectName, lectureFolder, fileName });
  }

  const folderEntries = [...folderEntriesMap.values()];

  // Load lecture HTML/metadata in parallel batches. Each entry is an
  // independent dynamic import through the workerd→vite bridge; running them
  // concurrently cuts the dev manifest rebuild from ~20s down to a few seconds.
  const BATCH_SIZE = 16;
  for (let batchStart = 0; batchStart < folderEntries.length; batchStart += BATCH_SIZE) {
    const batch = folderEntries.slice(batchStart, batchStart + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (entries) => {
      const selected = entries.find((e) => e.fileName.endsWith('_notes_enhanced')) || entries[0];
      const { key, subjectName, lectureFolder, fileName } = selected;

      const defaultDisplayName = fileName.replace(/_/g, ' ');

      // Load HTML and look for companion JSON
      const jsonKey = `/src/content/notes/${subjectName}/${lectureFolder}/${fileName}.json`;
      let metadata = null;
      if (jsonFiles[jsonKey]) {
        try {
          metadata = await resolveGlobEntry(jsonFiles[jsonKey]);
        } catch (err: any) {
          console.error(`[notesLoader] Error loading local json for ${subjectName}/${lectureFolder}:`, err.message);
        }
      }

      let htmlContent: string | null = null;
      try {
        htmlContent = (await resolveGlobEntry<string>(htmlFiles[key])) || null;
      } catch { /* optional */ }

      if (!metadata && htmlContent) {
        metadata = extractEmbeddedMetadata(htmlContent);
      }

      if (!metadata) {
        metadata = getFallbackMetadata(defaultDisplayName, subjectName);
      }

      return { subjectName, lectureFolder, fileName, displayName: defaultDisplayName, metadata };
    }));

    for (const result of results) {
      const { subjectName, lectureFolder, fileName, displayName, metadata } = result;

      if (!subjectsMap.has(subjectName)) {
        subjectsMap.set(subjectName, []);
      }

      subjectsMap.get(subjectName)!.push({
        name: displayName,
        folderName: lectureFolder,
        fileName: fileName,
        metadata: metadata,
      });

      totalLectures++;
    }
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
          htmlContent: lec.htmlContent,
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

/** Get a subject by its raw name or its slugified name. */
export async function getSubjectByNameOrSlug(nameOrSlug: string): Promise<SubjectSummary | null> {
  const subjects = await listSubjects();
  const matched = subjects.find(s => slugify(s.name) === slugify(nameOrSlug) || s.name === nameOrSlug);
  return matched || null;
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
    slug: l.slug || slugify(l.topicTitle || l.name),
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
      slug: l.slug || slugify(l.topicTitle || l.name),
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


/** Get the full HTML content and metadata for a specific lecture. */
export async function getLectureContent(subjectName: string, lectureFolderName: string): Promise<LectureContent | null> {
  const manifest = await getManifest();
  const subject = manifest.subjects.find(s => s.name === subjectName);
  if (!subject) return null;

  const lecture = subject.lectures.find(l => l.folderName === lectureFolderName);
  if (!lecture) return null;

  let htmlContent = '';
  let cssContent = '';
  let jsContent = '';
  
  if (import.meta.env.DEV) {
    // Development: load using Vite glob import
    try {
      const key = `/src/content/notes/${subjectName}/${lectureFolderName}/${lecture.fileName}.html`;
      if (htmlFiles[key]) {
        htmlContent = (await resolveGlobEntry<string>(htmlFiles[key])) || '';
      } else {
        const folderPrefix = `/src/content/notes/${subjectName}/${lectureFolderName}/`;
        const altKey = Object.keys(htmlFiles).find(k => k.startsWith(folderPrefix) && k.endsWith('.html'));
        if (altKey) {
          htmlContent = (await resolveGlobEntry<string>(htmlFiles[altKey])) || '';
        } else {
          console.error(`[notesLoader] Local file not found in glob: ${key}`);
          return null;
        }
      }

      // Load companion CSS if present
      const folderPrefix = `/src/content/notes/${subjectName}/${lectureFolderName}/`;
      const cssKeys = Object.keys(cssFiles).filter(k => k.toLowerCase().startsWith(folderPrefix.toLowerCase()) && k.endsWith('.css'));
      for (const cssKey of cssKeys) {
        try {
          const c = await resolveGlobEntry<string>(cssFiles[cssKey]);
          if (c) cssContent += '\n' + c;
        } catch (err: any) {
          console.warn(`[notesLoader] Error loading local CSS for ${subjectName}/${lectureFolderName}:`, err.message);
        }
      }

      // Load companion JS if present
      const jsKeys = Object.keys(jsFiles).filter(k => k.toLowerCase().startsWith(folderPrefix.toLowerCase()) && k.endsWith('.js'));
      for (const jsKey of jsKeys) {
        try {
          const j = await resolveGlobEntry<string>(jsFiles[jsKey]);
          if (j) jsContent += '\n' + j;
        } catch (err: any) {
          console.warn(`[notesLoader] Error loading local JS for ${subjectName}/${lectureFolderName}:`, err.message);
        }
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

      // Fetch optional companion CSS and JS from R2
      const folderPrefixKey = `notes/${subjectName}/${lectureFolderName}/`;
      try {
        const listRes = await bucket.list({ prefix: folderPrefixKey });
        if (listRes && listRes.objects) {
          for (const item of listRes.objects) {
            if (item.key.endsWith('.css')) {
              const cObj = await bucket.get(item.key);
              if (cObj) cssContent += '\n' + (await cObj.text());
            } else if (item.key.endsWith('.js')) {
              const jObj = await bucket.get(item.key);
              if (jObj) jsContent += '\n' + (await jObj.text());
            }
          }
        }
      } catch {
        // Fallback candidate keys if bucket.list is unpermitted
        const basePrefix = lecture.fileName.replace(/_notes(_enhanced)?$/i, '');
        const candidateJsKeys = [
          `${folderPrefixKey}${lecture.fileName}.js`,
          `${folderPrefixKey}${basePrefix}_enhancements.js`,
          `${folderPrefixKey}${basePrefix}.js`
        ];
        for (const jKey of candidateJsKeys) {
          try {
            const jsObj = await bucket.get(jKey);
            if (jsObj) { jsContent += '\n' + (await jsObj.text()); break; }
          } catch { /* optional */ }
        }
      }

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
    cssContent,
    jsContent,
    metadata: lecture.metadata,
    fileName: lecture.fileName
  };
}

export async function resolveLectureFolderName(subjectName: string, lectureSlugOrFolderName: string): Promise<string | null> {
  const lectures = await listLectures(subjectName);

  // Match by slug first
  const bySlug = lectures.find((l) => l.slug === lectureSlugOrFolderName);
  if (bySlug) return bySlug.folderName;

  // Match by folder name (user might have used folder name in URL)
  const byFolder = lectures.find((l) => l.folderName === lectureSlugOrFolderName);
  if (byFolder) return byFolder.folderName;

  // Direct match by display name
  const byName = lectures.find((l) => l.name === lectureSlugOrFolderName);
  if (byName) return byName.folderName;

  return null;
}

/** Legacy redirect parser (kept for backward compatibility with old /view/[id] URLs). */
export function parseLegacyLectureFolder(folderName: string): { subject: string; lecture: string } | null {
  const match = folderName.match(/^(.+?)\s*-\s*(Lecture\b.+)$/i);
  if (!match) return null;
  return { subject: match[1].trim(), lecture: match[2].trim() };
}
