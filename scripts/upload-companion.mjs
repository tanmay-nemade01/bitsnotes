/**
 * Upload textbook companion docs to R2 for the chatbot's lean retrieval.
 *
 * Source:  <COMPANION_SRC>/FOLDER/*.txt  (textbook chapters per subject code)
 * Dest R2: companion/<Subject Name>/index.json   (titles + previews + bundle offsets)
 *          companion/<Subject Name>/bundle.json  (concatenated full chapter texts)
 *
 * Bundles keep the object count tiny (2 per subject). The runtime ranks
 * index.json previews with the existing keyword engine and pulls at most 1
 * chapter per chat request via an R2 byte-range GET on bundle.json.
 *
 * Usage:
 *   node scripts/upload-companion.mjs [--dry-run] [--force] [--only "Subject Name"]
 *   COMPANION_SRC="D:\\E\\agent_warden\\companion_docs" node scripts/upload-companion.mjs
 *
 * Default source is the sibling agent_warden checkout on the author's machine;
 * override with --src <dir> or the COMPANION_SRC env var.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const BUCKET_NAME = 'bitsnotes';
const CACHE_FILE = path.join(process.cwd(), '.companion-upload-cache.json');
const NOTES_DIR = path.join(process.cwd(), 'src/content/notes');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── CLI args ─────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const FORCE_UPLOAD = ARGS.includes('--force') || ARGS.includes('-f');
const ONLY_IDX = ARGS.indexOf('--only');
const ONLY_SUBJECT = ONLY_IDX !== -1 ? ARGS[ONLY_IDX + 1] : null;
const SRC_IDX = ARGS.indexOf('--src');
const COMPANION_SRC =
  (SRC_IDX !== -1 && ARGS[SRC_IDX + 1]) ||
  process.env.COMPANION_SRC ||
  'D:\\E\\agent_warden\\companion_docs';

const PREVIEW_CHARS = 1200;

// ─── Folder code -> subject names (must match src/content/notes dir names) ─
// BDA intentionally serves two subjects (shared companion docs).
// Folder DDA was renamed from DSDA to avoid confusion.

const FOLDER_SUBJECTS = {
  ACI: ['Artificial Computational Intelligence'],
  AMTCS: ['AI & ML Techniques for Cyber Security'],
  ASM: ['Advanced Statistical Methods'],
  BDA: ['Big Data Analytics', 'Big Data Systems'],
  CS: ['Cyber Security'],
  DDA: ['Database Design and Applications'],
  DM: ['Data Mining'],
  DML: ['Distributed Machine Learning'],
  DMML: ['Data Management for Machine Learning'],
  DNN: ['Deep Neural Networks'],
  DRL: ['Deep Reinforcement Learning'],
  DSA: ['Data Structures and Algorithms'],
  DVI: ['Data Visualization and Interpretation'],
  DWH: ['Data Warehousing'],
  IR: ['Information Retrieval'],
  ISM: ['Introduction to Statistical Methods'],
  ITD: ['Introduction to Devops'],
  MFML: ['Mathematical Foundations for Machine Learning'],
  ML: ['Machine Learning'],
  NLP: ['Natural Language Processing'],
  OODAP: ['Object Oriented Design, Analysis and Programming Architecture'],
  OS: ['Operating Systems'],
  SA: ['Software Architectures'],
  SE: ['Software Engineering'],
  SEML: ['Software Engineering for Machine Learning'],
  SP: ['Systems Programming'],
  SPA: ['Stream Processing and Analytics'],
  SQL: ['SQL'],
  UDL: ['Unsupervised Deep Learning'],
  VA: ['Video Analysis'],
};

// ─── Helpers (mirrors deriveChapterTitle/cleanPlainText in chatbotRetrieval.ts) ─

function deriveChapterTitle(fileName) {
  let t = (fileName || '').replace(/\.txt$/i, '').trim();
  t = t.replace(/^[TR]\d+_/i, '');
  t = t.replace(/^(Ch|Chapter|Lecture|LN)[-_\s]*\d+[-_\s]*/i, '');
  t = t.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || fileName;
}

function cleanPlainText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function extractBookTag(fileName) {
  const m = fileName.match(/^([TR]\d+)_/i);
  return m ? m[1].toUpperCase() : '';
}

// ─── Cache & MD5 ──────────────────────────────────────────────────────────

let uploadCache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    uploadCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    console.warn(`${YELLOW}Warning: Could not parse .companion-upload-cache.json. Starting fresh.${RESET}`);
  }
}

function getFileMd5(filePath) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(uploadCache, null, 2), 'utf-8');
  } catch (err) {
    console.error(`${RED}Warning: Failed to save companion upload cache: ${err.message}${RESET}`);
  }
}

// ─── Validate source & mapping ────────────────────────────────────────────

if (!fs.existsSync(COMPANION_SRC)) {
  console.error(`${RED}Companion source dir not found: ${COMPANION_SRC}${RESET}`);
  console.error(`Pass --src <dir> or set COMPANION_SRC env var.`);
  process.exit(1);
}

const knownNotesSubjects = new Set();
if (fs.existsSync(NOTES_DIR)) {
  for (const d of fs.readdirSync(NOTES_DIR, { withFileTypes: true })) {
    if (d.isDirectory()) knownNotesSubjects.add(d.name);
  }
}

const sourceFolders = fs.readdirSync(COMPANION_SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const f of sourceFolders) {
  if (!FOLDER_SUBJECTS[f]) {
    console.warn(`${YELLOW}Warning: source folder "${f}" has no subject mapping — skipped.${RESET}`);
  }
}
for (const subjects of Object.values(FOLDER_SUBJECTS)) {
  for (const s of subjects) {
    if (knownNotesSubjects.size > 0 && !knownNotesSubjects.has(s)) {
      console.warn(`${YELLOW}Warning: mapped subject "${s}" not found under src/content/notes.${RESET}`);
    }
  }
}

// ─── Build per-subject bundles ────────────────────────────────────────────
// Each subject gets ONE bundle.json (concatenated raw chapter bytes) plus an
// index.json carrying {id, title, book, preview, offset, length} per chapter.
// Offsets are byte offsets into bundle.json so the worker can range-GET a
// single chapter. Chapter order is sorted by id for deterministic builds.

const tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.companion-'));
const subjects = new Map(); // subject -> { chapters: [{id,title,book,preview,buf}] }

for (const [folder, subjectNames] of Object.entries(FOLDER_SUBJECTS)) {
  const folderPath = path.join(COMPANION_SRC, folder);
  if (!fs.existsSync(folderPath)) {
    console.warn(`${YELLOW}Warning: folder missing on disk, skipped: ${folder}${RESET}`);
    continue;
  }
  const files = fs.readdirSync(folderPath).filter((f) => f.toLowerCase().endsWith('.txt'));
  for (const file of files) {
    // Skip helper/metadata exports — not textbook content.
    if (/mapping/i.test(file)) continue;
    const srcPath = path.join(folderPath, file);
    let buf;
    try {
      buf = fs.readFileSync(srcPath);
    } catch (err) {
      console.warn(`${YELLOW}Warning: cannot read ${folder}/${file}: ${err.message}${RESET}`);
      continue;
    }
    const clean = cleanPlainText(buf.toString('utf-8'));
    if (clean.length < 100) {
      console.warn(`${YELLOW}Warning: tiny file skipped: ${folder}/${file} (${clean.length} chars)${RESET}`);
      continue;
    }
    const id = file.replace(/\.txt$/i, '');
    const entry = {
      id,
      title: deriveChapterTitle(file),
      book: extractBookTag(file),
      preview: clean.slice(0, PREVIEW_CHARS),
      buf,
    };
    for (const subject of subjectNames) {
      if (ONLY_SUBJECT && subject !== ONLY_SUBJECT) continue;
      if (!subjects.has(subject)) subjects.set(subject, { chapters: [] });
      subjects.get(subject).chapters.push(entry);
    }
  }
}

console.log(`\nBuilt companion payloads for ${subjects.size} subjects:`);
let totalChapters = 0;
const bundlePaths = [];
for (const [subject, payload] of subjects) {
  payload.chapters.sort((a, b) => a.id.localeCompare(b.id));
  totalChapters += payload.chapters.length;

  // Concatenate chapter buffers; record byte offsets.
  let offset = 0;
  const parts = [];
  for (const ch of payload.chapters) {
    ch.offset = offset;
    ch.length = ch.buf.length;
    parts.push(ch.buf);
    offset += ch.buf.length;
  }
  const bundleBuf = Buffer.concat(parts);
  const bundlePath = path.join(tmpDir, `${crypto.createHash('md5').update(subject).digest('hex')}.bundle`);
  fs.writeFileSync(bundlePath, bundleBuf);
  bundlePaths.push(bundlePath);
  payload.bundlePath = bundlePath;
  payload.bundleBytes = bundleBuf.length;

  const previewBytes = payload.chapters.reduce((n, c) => n + c.preview.length, 0);
  console.log(
    `  - ${subject}: ${payload.chapters.length} chapters, ` +
    `bundle ~${(bundleBuf.length / 1024 / 1024).toFixed(1)} MB, index ~${(previewBytes / 1024).toFixed(0)} KB`
  );
}
console.log(`Total chapter references: ${totalChapters}\n`);

// Sanity-check byte offsets: slice first/last chapter back out of each bundle.
for (const [subject, payload] of subjects) {
  const bundleBuf = fs.readFileSync(payload.bundlePath);
  const probes = [payload.chapters[0], payload.chapters[payload.chapters.length - 1]].filter(Boolean);
  for (const ch of probes) {
    const slice = bundleBuf.subarray(ch.offset, ch.offset + ch.length);
    if (!slice.equals(ch.buf)) {
      console.error(`${RED}Offset mismatch in ${subject}/${ch.id} — aborting.${RESET}`);
      process.exit(1);
    }
  }
}
console.log(`${GREEN}Offset check passed for all ${subjects.size} bundles.${RESET}\n`);

// ─── Queue uploads ────────────────────────────────────────────────────────

const uploadQueue = [];
let skippedCount = 0;

function queueFile(localPath, remoteKey, contentType, hash) {
  if (!FORCE_UPLOAD && uploadCache[remoteKey] === hash) {
    skippedCount++;
    return;
  }
  uploadQueue.push({ localPath, remoteKey, contentType, hash });
}

const indexPaths = [];
for (const [subject, payload] of subjects) {
  const indexObj = {
    version: 2,
    subject,
    updatedAt: new Date().toISOString(),
    bundle: 'bundle.json',
    chapters: payload.chapters.map(({ id, title, book, preview, offset, length }) => ({
      id, title, book, preview, offset, length,
    })),
  };
  const indexPath = path.join(tmpDir, `${crypto.createHash('md5').update(subject).digest('hex')}.json`);
  fs.writeFileSync(indexPath, JSON.stringify(indexObj), 'utf-8');
  indexPaths.push(indexPath);
  queueFile(indexPath, `companion/${subject}/index.json`, 'application/json', getFileMd5(indexPath));
  queueFile(payload.bundlePath, `companion/${subject}/bundle.json`, 'application/json', getFileMd5(payload.bundlePath));
}

console.log(`Smart Sync: ${skippedCount} file(s) already up-to-date, ${uploadQueue.length} to upload.`);

if (DRY_RUN) {
  console.log(`${YELLOW}Dry run — no uploads performed. Sample index entry:${RESET}`);
  const first = subjects.values().next().value;
  if (first && first.chapters[0]) {
    const c = first.chapters[0];
    console.log(JSON.stringify({ id: c.id, title: c.title, book: c.book, offset: c.offset, length: c.length, preview: c.preview.slice(0, 200) + '…' }, null, 2));
  }
  for (const p of [...indexPaths, ...bundlePaths]) fs.unlinkSync(p);
  fs.rmdirSync(tmpDir);
  process.exit(0);
}

// ─── Concurrency-limited uploader (mirrors upload-notes.mjs) ─────────────

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

async function uploadFile(item, index, total) {
  const percent = Math.round((index / total) * 100);
  console.log(`[${index}/${total}] (${percent}%) Uploading ${item.remoteKey}...`);
  const cmd = `npx wrangler r2 object put "${BUCKET_NAME}/${item.remoteKey}" --file "${item.localPath}" --ct "${item.contentType}" --remote`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      if (item.hash) {
        uploadCache[item.remoteKey] = item.hash;
        saveCache();
      }
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`${YELLOW}Attempt ${attempt}/3 failed for ${item.remoteKey}, retrying...${RESET}`);
    }
  }
  console.error(`${RED}Failed to upload ${item.remoteKey}: ${lastErr && lastErr.message}${RESET}`);
  throw lastErr;
}

try {
  if (uploadQueue.length === 0) {
    console.log(`\n${GREEN}${BOLD}Everything is already up-to-date.${RESET}\n`);
  } else {
    await runWithLimit(8, uploadQueue, uploadFile);
    console.log(`\n${GREEN}${BOLD}Success! Companion sync to R2 completed.${RESET}\n`);
  }
} catch {
  console.error(`\n${RED}${BOLD}Sync completed with errors.${RESET}`);
} finally {
  for (const p of [...indexPaths, ...bundlePaths]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
  try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
}
