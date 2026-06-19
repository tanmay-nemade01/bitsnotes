/**
 * Build-time content loader for notes stored in the git repository.
 *
 * Uses Vite's `import.meta.glob` to load HTML and companion JSON metadata files
 * statically at build time. This ensures all files are bundled and accessible
 * within the Cloudflare prerendering and worker environment without requiring
 * raw filesystem access.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubjectSummary {
  name: string;
  lectureCount: number;
}

export interface LectureSummary {
  /** Display name for the lecture (from metadata title, or derived from folder) */
  name: string;
  /** Folder name on disk (used for URL routing) */
  folderName: string;
}

export interface LectureContent {
  htmlContent: string;
  metadata: Record<string, any> | null;
}

// ─── Static Glob Imports ─────────────────────────────────────────────────────

// Load all HTML files in the notes directory as raw strings
const htmlFiles = import.meta.glob('/src/content/notes/**/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Load all companion JSON files in the notes directory
const jsonFiles = import.meta.glob('/src/content/notes/**/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, any>;

// ─── Parsed Notes In-Memory Structure ────────────────────────────────────────

interface ParsedNote {
  subject: string;
  lectureFolder: string;
  htmlPath: string;
  htmlContent: string;
}

const notes: ParsedNote[] = [];

for (const [htmlPath, htmlContent] of Object.entries(htmlFiles)) {
  // htmlPath looks like: "/src/content/notes/SubjectName/LectureFolder/File.html"
  const relative = htmlPath.replace(/^\/src\/content\/notes\//, '');
  const parts = relative.split('/');
  if (parts.length >= 3) {
    const subject = parts[0];
    const lectureFolder = parts[1];
    notes.push({
      subject,
      lectureFolder,
      htmlPath,
      htmlContent,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract metadata from <script type="application/json" id="lecture-metadata"> in HTML. */
function extractEmbeddedMetadata(htmlContent: string): Record<string, any> | null {
  const match = htmlContent.match(
    /<script\s+type=["']application\/json["']\s+id=["']lecture-metadata["']\s*>(.*?)<\/script>/s
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Derive a human-readable lecture display name from a folder name.
 * e.g. "DRL_Lecture_1_Notes" → "Lecture 1"
 *      "SEML_Lecture_1_and_2_Notes" → "Lecture 1 and 2"
 *      "SEML_Lecure_8_notes" → "Lecture 8"  (handles typos in folder names)
 */
function folderToDisplayName(folderName: string): string {
  const match = folderName.match(/Lec(?:tu|u)re[_\s-]+(.+?)(?:[_\s-]+[Nn]otes?)?$/i);
  if (match) {
    const rest = match[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return `Lecture ${rest}`;
  }
  return folderName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Legacy redirect parser (kept for backward compatibility with old /view/[id] URLs). */
export function parseLegacyLectureFolder(folderName: string): { subject: string; lecture: string } | null {
  const match = folderName.match(/^(.+?)\s*-\s*(Lecture\b.+)$/i);
  if (!match) return null;
  return { subject: match[1].trim(), lecture: match[2].trim() };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** List all subjects with their lecture counts. */
export function listSubjects(): SubjectSummary[] {
  const subjectMap = new Map<string, number>();
  for (const note of notes) {
    subjectMap.set(note.subject, (subjectMap.get(note.subject) || 0) + 1);
  }
  return Array.from(subjectMap.entries())
    .map(([name, lectureCount]) => ({ name, lectureCount }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** List all lectures within a subject. */
export function listLectures(subjectName: string): LectureSummary[] {
  const subjectNotes = notes.filter((n) => n.subject === subjectName);

  return subjectNotes
    .map((note) => {
      // Find companion json path
      const jsonPath = note.htmlPath.replace(/\.html?$/i, '.json');
      const companionJson = jsonFiles[jsonPath];

      let displayName = folderToDisplayName(note.lectureFolder);
      if (companionJson?.title) {
        displayName = companionJson.title;
      } else {
        const metadata = extractEmbeddedMetadata(note.htmlContent);
        if (metadata?.title) {
          displayName = metadata.title;
        }
      }

      return {
        name: displayName,
        folderName: note.lectureFolder,
      };
    })
    .sort((a, b) => {
      // Sort by lecture number numerically if possible
      const numA = a.folderName.match(/(\d+)/);
      const numB = b.folderName.match(/(\d+)/);
      if (numA && numB) {
        return parseInt(numA[1]) - parseInt(numB[1]);
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
}

/** Get the full HTML content and metadata for a specific lecture. */
export function getLectureContent(subjectName: string, lectureFolderName: string): LectureContent | null {
  const note = notes.find((n) => n.subject === subjectName && n.lectureFolder === lectureFolderName);
  if (!note) return null;

  const jsonPath = note.htmlPath.replace(/\.html?$/i, '.json');
  let metadata = jsonFiles[jsonPath] || null;
  if (!metadata) {
    metadata = extractEmbeddedMetadata(note.htmlContent);
  }

  return {
    htmlContent: note.htmlContent,
    metadata,
  };
}

/**
 * Resolve a lecture display name back to a folder name.
 * Used when URL params use the display name and we need the folder.
 */
export function resolveLectureFolderName(subjectName: string, lectureDisplayName: string): string | null {
  const lectures = listLectures(subjectName);

  // Direct match by display name
  const byName = lectures.find((l) => l.name === lectureDisplayName);
  if (byName) return byName.folderName;

  // Direct match by folder name (user might have used folder name in URL)
  const byFolder = lectures.find((l) => l.folderName === lectureDisplayName);
  if (byFolder) return byFolder.folderName;

  return null;
}
