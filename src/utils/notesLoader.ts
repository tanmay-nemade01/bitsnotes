import { env } from 'cloudflare:workers';
import { getFallbackMetadata } from './metadata';

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

// ─── Node.js imports for local development ───────────────────────────────────
// We load these dynamically at runtime during dev using top-level imports.
// In production (Cloudflare), these imports will be evaluated but not executed,
// and we avoid bundler errors by using dynamic string variables.
const fsModule = 'node:fs';
const pathModule = 'node:path';
const fs = import.meta.env.DEV ? await import(fsModule) : null;
const path = import.meta.env.DEV ? await import(pathModule) : null;

const NOTES_DIR = import.meta.env.DEV ? path!.join(process.cwd(), 'src/content/notes') : '';

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

  // Production: fetch from R2 with 10-second TTL cache
  if (manifestCache && (now - lastFetchedTime < 10000)) {
    return manifestCache;
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[notesLoader] NOTES_BUCKET binding not found. Ensure wrangler.jsonc contains the R2 binding.');
    return { version: 'empty', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
  }

  try {
    const obj = await bucket.get('notes-manifest.json');
    if (!obj) {
      console.warn('[notesLoader] notes-manifest.json not found in R2 bucket.');
      return { version: 'empty', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
    }
    const manifest = (await obj.json()) as NotesManifest;
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
  const subjectsList: SubjectEntry[] = [];
  let totalLectures = 0;

  if (!fs || !path || !fs.existsSync(NOTES_DIR)) {
    return { version: 'dev-empty', subjects_count: 0, total_lectures: 0, updatedAt: '', subjects: [] };
  }

  try {
    const subjectFolders = fs.readdirSync(NOTES_DIR, { withFileTypes: true })
      .filter((dirent: any) => dirent.isDirectory())
      .map((dirent: any) => dirent.name);

    for (const subjectName of subjectFolders) {
      const subjectPath = path.join(NOTES_DIR, subjectName);
      const lectureFolders = fs.readdirSync(subjectPath, { withFileTypes: true })
        .filter((dirent: any) => dirent.isDirectory())
        .map((dirent: any) => dirent.name);

      const lecturesList: LectureEntry[] = [];

      for (const lectureFolder of lectureFolders) {
        const lecturePath = path.join(subjectPath, lectureFolder);
        const files = fs.readdirSync(lecturePath);
        
        const htmlFile = files.find((f: any) => f.endsWith('.html'));
        if (!htmlFile) continue;

        const htmlPath = path.join(lecturePath, htmlFile);
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        const fileName = htmlFile.replace(/\.html?$/i, '');
        const defaultDisplayName = fileName.replace(/_/g, ' ');

        let metadata = null;
        const jsonFile = files.find((f: any) => f.endsWith('.json'));
        if (jsonFile) {
          try {
            metadata = JSON.parse(fs.readFileSync(path.join(lecturePath, jsonFile), 'utf-8'));
          } catch {}
        }
        
        if (!metadata) {
          metadata = extractEmbeddedMetadata(htmlContent);
        }
        if (!metadata) {
          metadata = getFallbackMetadata(defaultDisplayName, subjectName);
        }

        const displayName = metadata.title || defaultDisplayName;

        lecturesList.push({
          name: displayName,
          folderName: lectureFolder,
          fileName: fileName,
          metadata: metadata
        });

        totalLectures++;
      }

      // Sort lectures numerically by lecture number in folder name
      lecturesList.sort((a, b) => {
        const numA = a.folderName.match(/(\d+)/);
        const numB = b.folderName.match(/(\d+)/);
        if (numA && numB) {
          return parseInt(numA[1]) - parseInt(numB[1]);
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      subjectsList.push({
        name: subjectName,
        lectureCount: lecturesList.length,
        lectures: lecturesList
      });
    }

    subjectsList.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    console.error('[notesLoader] Error building local notes manifest:', err.message);
  }

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

/** List all lectures within a subject. */
export async function listLectures(subjectName: string): Promise<LectureSummary[]> {
  const manifest = await getManifest();
  const subject = manifest.subjects.find(s => s.name === subjectName);
  if (!subject) return [];
  return subject.lectures.map(l => ({
    name: l.name,
    folderName: l.folderName
  }));
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
    // Development: read directly from local filesystem
    try {
      const htmlPath = path!.join(NOTES_DIR, subjectName, lectureFolderName, `${lecture.fileName}.html`);
      htmlContent = fs!.readFileSync(htmlPath, 'utf-8');
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
