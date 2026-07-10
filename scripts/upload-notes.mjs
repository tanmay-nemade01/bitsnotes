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

console.log(`${BOLD}BitsNotes R2 Upload Script${RESET}\n`);

if (!fs.existsSync(NOTES_DIR)) {
  console.error(`${RED}Error: notes directory not found at ${NOTES_DIR}${RESET}`);
  process.exit(1);
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
    
    // Find HTML file
    const htmlFile = files.find(f => f.endsWith('.html'));
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
    const jsonFile = files.find(f => f.endsWith('.json'));
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

    const displayName = metadata.title || defaultDisplayName;

    lecturesList.push({
      name: displayName,
      folderName: lectureFolder,
      fileName: fileName,
      metadata: metadata
    });

    totalLectures++;

    // Add HTML note to upload queue ONLY if it changed
    const htmlHash = getFileMd5(htmlPath);
    const remoteHtmlKey = `notes/${subjectName}/${lectureFolder}/${htmlFile}`;
    if (uploadCache[remoteHtmlKey] !== htmlHash) {
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
      if (uploadCache[remoteJsonKey] !== jsonHash) {
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

    // Add to search index
    const cleanText = cleanHtmlText(htmlContent);
    const title = metadata.title ? `${defaultDisplayName} — ${metadata.title}` : defaultDisplayName;
    searchIndex.push({
      title,
      subject: subjectName,
      folderName: lectureFolder,
      text: cleanText
    });
  }

  // Sort lectures by folder name number numerically (matches old notesLoader.ts sort)
  lecturesList.sort((a, b) => {
    const numA = a.folderName.match(/(\d+)/);
    const numB = b.folderName.match(/(\d+)/);
    if (numA && numB) {
      return parseInt(numA[1]) - parseInt(numB[1]);
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
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
    
    // Save successful upload to local cache
    if (item.hash) {
      uploadCache[item.remoteKey] = item.hash;
      saveCache();
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
