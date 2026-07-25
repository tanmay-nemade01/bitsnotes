import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const BUCKET_NAME = 'bitsnotes';
const NOTES_DIR = path.join(process.cwd(), 'src/content/notes');
const CACHE_FILE = path.join(process.cwd(), '.notes-upload-cache.json');

// Colors for console output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const FORCE_UPLOAD = process.argv.includes('--force') || process.argv.includes('-f');
if (FORCE_UPLOAD) {
  console.log(`${YELLOW}Force mode enabled: Bypassing cache checks for all files.${RESET}\n`);
}

// ─── Cache & MD5 Helpers ──────────────────────────────────────────────────────

let uploadCache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    uploadCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    console.warn(`${YELLOW}Warning: Could not parse .notes-upload-cache.json. Starting fresh sync.${RESET}`);
  }
}

function getFileMd5(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(uploadCache, null, 2), 'utf-8');
  } catch (err) {
    console.error(`${RED}Warning: Failed to save upload cache file: ${err.message}${RESET}`);
  }
}

function getCachedHash(key) {
  if (uploadCache[key] !== undefined) {
    return uploadCache[key];
  }
  // Fallback: Case-insensitive match to handle casing changes gracefully
  const lowerKey = key.toLowerCase();
  for (const existingKey of Object.keys(uploadCache)) {
    if (existingKey.toLowerCase() === lowerKey) {
      const hash = uploadCache[existingKey];
      delete uploadCache[existingKey];
      uploadCache[key] = hash;
      saveCache();
      return hash;
    }
  }
  return undefined;
}

function updateCacheEntry(key, hash) {
  const lowerKey = key.toLowerCase();
  for (const existingKey of Object.keys(uploadCache)) {
    if (existingKey.toLowerCase() === lowerKey && existingKey !== key) {
      delete uploadCache[existingKey];
    }
  }
  uploadCache[key] = hash;
  saveCache();
}

// ─── Metadata Helpers ────────────────────────────────────────────────────────

function extractEmbeddedMetadata(htmlContent) {
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

function getFallbackMetadata(lectureName, subjectName) {
  let subject = subjectName || 'General Course Notes';
  let displayTitle = lectureName;
  
  const parts = lectureName.split(' - ');
  if (parts.length >= 2) {
    subject = parts[0].trim();
    displayTitle = parts.slice(1).join(' - ').trim();
  }

  let readableTitle = displayTitle;
  if (/^lecture[\s_-]*\d+$/i.test(displayTitle)) {
    const num = displayTitle.match(/\d+/)?.[0];
    readableTitle = `Lecture ${num}`;
  } else {
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
    gradeLevel: 'High School / Undergraduate',
    datePublished: formattedDate,
    targetAudience: `Students studying ${readableTitle} under the ${subject} curriculum.`,
    summary: `This comprehensive study guide covers the essential concepts, equations, and methodologies presented in the ${subject} document '${readableTitle}'.`,
    keyConcepts: [
      `Understand the key definitions, terminology, and course context of ${subject}.`,
      `Analyze the core mechanisms, models, and equations introduced in the ${readableTitle} notes.`,
    ],
    sections: [
      {
        title: 'Section 1: Foundations and Background',
        pages: 'Pages 1-2',
        description: `Overview of basic ${subject} concepts and terminology.`
      }
    ],
    quiz: [],
    pageTranscripts: []
  };
}

function cleanHtmlText(html) {
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, ' ').trim();
}

// ─── Catalog normalization (mirrors src/utils/lectureDisplay.ts) ────────────
// Kept in sync with the TS helper so the production manifest carries the same
// fields as the dev manifest. Lecture numbers are NEVER derived from an index.

const RESOURCE_KIND_PATTERNS = [
  [/solved/i, 'solved-paper'],
  [/one[_\s-]?sheet/i, 'one-sheet'],
  [/worksheet/i, 'worksheet'],
  [/question[_\s-]?bank/i, 'question-bank'],
  [/concept[_\s-]?map/i, 'concept-map'],
  [/race[_\s-]?card/i, 'race-card'],
];

function detectResourceKind(folderName, metadata) {
  if (metadata && metadata.resourceKind) return metadata.resourceKind;
  for (const [re, kind] of RESOURCE_KIND_PATTERNS) {
    if (re.test(folderName)) return kind;
  }
  return 'lecture';
}

function parseFolderLectureNumbers(folderName) {
  const range =
    folderName.match(/(\d+)[_\s-]*and[_\s-]*(\d+)/i) ??
    folderName.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (range) return { start: parseInt(range[1], 10), end: parseInt(range[2], 10) };
  const single = folderName.match(/lecture[_\s-]*(\d+)/i);
  if (single) return { start: parseInt(single[1], 10) };
  return {};
}

function pad2(n) { return n.toString().padStart(2, '0'); }

function deriveTopicTitle(folderName, metadata) {
  if (metadata && metadata.topicTitle) return metadata.topicTitle;
  if (metadata && metadata.title) return metadata.title;
  let t = folderName;
  t = t.replace(/^[A-Za-z]{2,5}[_\s-]+/, '');
  t = t.replace(/lecture[_\s-]*\d+(?:[_\s-]*and[_\s-]*\d+)?/i, '');
  t = t.replace(/[_\s-]*(notes?|solved|regular|midsem|one[_\s-]?sheet|worksheet|question[_\s-]?bank|concept[_\s-]?map|race[_\s-]?card)\b/gi, '');
  t = t.replace(/[_\s-]+/g, ' ').trim();
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function formatLectureLabel({ lectureNumber, lectureNumberEnd, topicTitle, resourceKind }) {
  const isLecture = resourceKind === 'lecture' || resourceKind === undefined;
  let prefix;
  if (isLecture) {
    if (lectureNumber != null && lectureNumberEnd != null) {
      prefix = `Lectures ${pad2(lectureNumber)}–${pad2(lectureNumberEnd)}`;
    } else if (lectureNumber != null) {
      prefix = `Lecture ${pad2(lectureNumber)}`;
    } else {
      prefix = '';
    }
  } else {
    const labels = {
      'solved-paper': 'Solved Paper',
      'one-sheet': 'One Sheet',
      'worksheet': 'Worksheet',
      'question-bank': 'Question Bank',
      'concept-map': 'Concept Map',
      'race-card': 'Race Card',
    };
    prefix = labels[resourceKind] || 'Resource';
  }
  if (topicTitle) return prefix ? `${prefix} · ${topicTitle}` : topicTitle;
  return prefix;
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars except -
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '');            // Trim - from end
}

function normalizeCatalogEntry({ folderName, fileName, name, metadata }) {
  const resourceKind = detectResourceKind(folderName, metadata);
  const scope = (metadata && metadata.scope) || (resourceKind === 'lecture' ? 'lecture' : 'subject');
  const folderNums = parseFolderLectureNumbers(folderName);
  const lectureNumber = (metadata && metadata.lectureNumber) ?? folderNums.start;
  const lectureNumberEnd = (metadata && metadata.lectureNumberEnd) ?? folderNums.end;
  const topicTitle = deriveTopicTitle(folderName, metadata);
  const metadataSource = (metadata && metadata.metadataSource) || 'fallback';
  const authored = metadataSource !== 'fallback';
  const authoredQuizCount = authored ? (metadata && metadata.quiz ? metadata.quiz.length : 0) : 0;

  const availableModes = (metadata && metadata.availableModes) || (() => {
    const modes = ['notes', 'study-guide'];
    if (!authored) return modes;
    if (metadata && metadata.examRevisionNotes && metadata.examRevisionNotes.length > 0) modes.push('exam-revision');
    if (metadata && metadata.quiz && metadata.quiz.length > 0) modes.push('quiz');
    if (resourceKind !== 'lecture' && !modes.includes('exam-revision')) modes.push('exam-revision');
    return modes;
  })();

  const sortOrder = (metadata && metadata.sortOrder) != null
    ? metadata.sortOrder
    : (resourceKind === 'lecture' ? (lectureNumber != null ? lectureNumber : 999) : 1000);

  const displayTitle = formatLectureLabel({ lectureNumber, lectureNumberEnd, topicTitle, resourceKind });

  return {
    name,
    folderName,
    fileName,
    topicTitle,
    displayTitle,
    slug: slugify(topicTitle),
    lectureNumber,
    lectureNumberEnd,
    resourceKind,
    availableModes,
    scope,
    sortOrder,
    shortDescription: metadata && metadata.shortDescription,
    topics: metadata && metadata.topics,
    metadataSource,
    authoredQuizCount,
  };
}

// ─── Main Scanning ──────────────────────────────────────────────────────────

const subjects = [];
const searchIndex = [];
const uploadQueue = []; // Array of { localPath, remoteKey, contentType, hash }
let skippedCount = 0;

const subjectFolders = fs.readdirSync(NOTES_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

let totalLectures = 0;

for (const subjectName of subjectFolders) {
  const subjectPath = path.join(NOTES_DIR, subjectName);
  const lectureFolders = fs.readdirSync(subjectPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const lecturesList = [];

  for (const lectureFolder of lectureFolders) {
    const lecturePath = path.join(subjectPath, lectureFolder);
    const files = fs.readdirSync(lecturePath);
    
    // Find HTML file (prefer enhanced HTML if present)
    const htmlFile = files.find(f => f.endsWith('_notes_enhanced.html')) || files.find(f => f.endsWith('.html'));
    if (!htmlFile) {
      console.warn(`${YELLOW}Warning: No HTML file found in ${subjectName}/${lectureFolder}${RESET}`);
      continue;
    }

    const htmlPath = path.join(lecturePath, htmlFile);
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const fileName = htmlFile.replace(/\.html?$/i, '');
    const defaultDisplayName = fileName.replace(/_/g, ' ');

    // Find companion JSON or extract embedded metadata
    let metadata = null;
    const jsonFile = files.find(f => f.endsWith('.json') && !f.endsWith('_enhancement_audit.json'));
    if (jsonFile) {
      try {
        metadata = JSON.parse(fs.readFileSync(path.join(lecturePath, jsonFile), 'utf-8'));
      } catch (err) {
        console.error(`${RED}Error parsing JSON metadata in ${subjectName}/${lectureFolder}: ${err.message}${RESET}`);
      }
    }
    
    if (!metadata) {
      metadata = extractEmbeddedMetadata(htmlContent);
    }
    if (!metadata) {
      metadata = getFallbackMetadata(defaultDisplayName, subjectName);
    }

    const displayName = defaultDisplayName;

    // Normalize into a catalog entry (carries display title, lecture number,
    // resource kind, authored quiz count, etc.) so the manifest can render the
    // catalog without fetching lecture HTML.
    const catalogEntry = normalizeCatalogEntry({
      subject: subjectName,
      folderName: lectureFolder,
      fileName: fileName,
      name: displayName,
      metadata: metadata
    });

    // Retain the raw metadata so getLectureContent() can return it to the
    // viewer (scope, resourceKind, topicTitle, summary, quiz, etc.).
    lecturesList.push({ ...catalogEntry, metadata });

    totalLectures++;

    // Add HTML note to upload queue ONLY if it changed
    const htmlHash = getFileMd5(htmlPath);
    const remoteHtmlKey = `notes/${subjectName}/${lectureFolder}/${htmlFile}`;
    if (FORCE_UPLOAD || getCachedHash(remoteHtmlKey) !== htmlHash) {
      uploadQueue.push({
        localPath: htmlPath,
        remoteKey: remoteHtmlKey,
        contentType: 'text/html',
        hash: htmlHash
      });
    } else {
      skippedCount++;
    }

    // Add JSON metadata to upload queue ONLY if it changed
    if (jsonFile) {
      const jsonPath = path.join(lecturePath, jsonFile);
      const jsonHash = getFileMd5(jsonPath);
      const remoteJsonKey = `notes/${subjectName}/${lectureFolder}/${jsonFile}`;
      if (FORCE_UPLOAD || getCachedHash(remoteJsonKey) !== jsonHash) {
        uploadQueue.push({
          localPath: jsonPath,
          remoteKey: remoteJsonKey,
          contentType: 'application/json',
          hash: jsonHash
        });
      } else {
        skippedCount++;
      }
    }

    // Add companion CSS files (e.g. per-lecture enhancements CSS) to upload queue
    const cssFiles = files.filter(f => f.endsWith('.css'));
    for (const cssFile of cssFiles) {
      const cssPath = path.join(lecturePath, cssFile);
      const cssHash = getFileMd5(cssPath);
      const remoteCssKey = `notes/${subjectName}/${lectureFolder}/${cssFile}`;
      if (FORCE_UPLOAD || getCachedHash(remoteCssKey) !== cssHash) {
        uploadQueue.push({
          localPath: cssPath,
          remoteKey: remoteCssKey,
          contentType: 'text/css',
          hash: cssHash
        });
      } else {
        skippedCount++;
      }
    }

    // Add companion JS files (e.g. per-lecture enhancements JS) to upload queue
    const jsFiles = files.filter(f => f.endsWith('.js'));
    for (const jsFile of jsFiles) {
      const jsPath = path.join(lecturePath, jsFile);
      const jsHash = getFileMd5(jsPath);
      const remoteJsKey = `notes/${subjectName}/${lectureFolder}/${jsFile}`;
      if (FORCE_UPLOAD || getCachedHash(remoteJsKey) !== jsHash) {
        uploadQueue.push({
          localPath: jsPath,
          remoteKey: remoteJsKey,
          contentType: 'application/javascript',
          hash: jsHash
        });
      } else {
        skippedCount++;
      }
    }

    // Add to search index — use the normalized display title for better matches.
    const cleanText = cleanHtmlText(htmlContent);
    const title = catalogEntry.displayTitle || defaultDisplayName;
    searchIndex.push({
      title,
      subject: subjectName,
      folderName: lectureFolder,
      slug: catalogEntry.slug,
      snippet: cleanText.slice(0, 300)
    });
  }

  // Sort lectures by their stable sortOrder (real lecture number, never index).
  lecturesList.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.displayTitle.localeCompare(b.displayTitle);
  });

  subjects.push({
    name: subjectName,
    lectureCount: lecturesList.length,
    lectures: lecturesList
  });
}

// Sort subjects alphabetically
subjects.sort((a, b) => a.name.localeCompare(b.name));

const timestamp = new Date().toISOString();
const versionHash = crypto.createHash('sha256').update(timestamp + totalLectures).digest('hex').substring(0, 16);

const manifest = {
  version: versionHash,
  subjects_count: subjects.length,
  total_lectures: totalLectures,
  updatedAt: timestamp,
  subjects: subjects
};

// Write manifest and search index to temporary local files
const manifestPath = path.join(process.cwd(), '.notes-manifest.json');
const searchIndexPath = path.join(process.cwd(), '.search-index.json');

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
fs.writeFileSync(searchIndexPath, JSON.stringify(searchIndex), 'utf-8');

// Manifest and Search Index are ALWAYS uploaded
uploadQueue.push({
  localPath: manifestPath,
  remoteKey: 'notes-manifest.json',
  contentType: 'application/json'
});

uploadQueue.push({
  localPath: searchIndexPath,
  remoteKey: 'search-index.json',
  contentType: 'application/json'
});

console.log(`Found ${subjects.length} subjects and ${totalLectures} lectures.`);
console.log(`Smart Sync Status: ${skippedCount} file(s) are already up-to-date and skipped.`);
console.log(`Queueing ${uploadQueue.length} files (including manifest & search index) to upload to R2 bucket "${BUCKET_NAME}"...\n`);

// ─── Concurrency-Limited Uploader ──────────────────────────────────────────

async function runWithLimit(limit, items, fn) {
  const results = [];
  const executing = new Set();
  let count = 0;

  for (const item of items) {
    count++;
    const currentCount = count;
    const p = Promise.resolve().then(() => fn(item, currentCount, items.length));
    results.push(p);
    executing.add(p);
    
    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

const CONCURRENCY_LIMIT = 8;

async function uploadFile(item, index, total) {
  const percent = Math.round((index / total) * 100);
  console.log(`[${index}/${total}] (${percent}%) Uploading ${item.remoteKey}...`);
  
  const cmd = `npx wrangler r2 object put "${BUCKET_NAME}/${item.remoteKey}" --file "${item.localPath}" --ct "${item.contentType}" --remote`;
  try {
    execSync(cmd, { stdio: 'ignore' });
    
    // Save successful upload to local cache with stale key cleanup
    if (item.hash) {
      updateCacheEntry(item.remoteKey, item.hash);
    }
  } catch (err) {
    console.error(`${RED}Failed to upload ${item.remoteKey}: ${err.message}${RESET}`);
    throw err;
  }
}

try {
  if (uploadQueue.length > 2) {
    // Only notes + manifest + search index
    await runWithLimit(CONCURRENCY_LIMIT, uploadQueue, uploadFile);
  } else if (uploadQueue.length === 2) {
    // Only manifest + search index need upload, meaning no notes changed!
    console.log(`No notes files have changed. Uploading updated manifest and search index...`);
    await runWithLimit(CONCURRENCY_LIMIT, uploadQueue, uploadFile);
  }
  console.log(`\n${GREEN}${BOLD}Success! Sync to R2 completed successfully.${RESET}`);
} catch (err) {
  console.error(`\n${RED}${BOLD}Sync completed with errors.${RESET}`);
} finally {
  // Clean up temporary files
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  if (fs.existsSync(searchIndexPath)) fs.unlinkSync(searchIndexPath);
}
