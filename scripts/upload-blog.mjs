import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const BUCKET_NAME = 'bitsnotes';
const BLOG_DIR = path.join(process.cwd(), 'src/content/blog');
const CACHE_FILE = path.join(process.cwd(), '.blog-upload-cache.json');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const FORCE_UPLOAD = process.argv.includes('--force') || process.argv.includes('-f');
if (FORCE_UPLOAD) {
  console.log(`${YELLOW}Force mode enabled: Bypassing cache checks for all files.${RESET}\n`);
}

let uploadCache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    uploadCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    console.warn(`${YELLOW}Warning: Could not parse .blog-upload-cache.json. Starting fresh sync.${RESET}`);
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
    console.error(`${RED}Warning: Failed to save upload cache file: ${err.message}${RESET}`);
  }
}

function updateCacheEntry(key, hash) {
  uploadCache[key] = hash;
  saveCache();
}

function cleanHtmlText(html) {
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
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

function contentTypeFor(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js')) return 'application/javascript';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

const MEDIA_EXT = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.css', '.js'];

if (!fs.existsSync(BLOG_DIR)) {
  console.error(`${RED}No blog directory found at ${BLOG_DIR}${RESET}`);
  process.exit(1);
}

const uploadQueue = [];
const manifestPosts = [];
const searchEntries = [];
let skippedCount = 0;
let publishedCount = 0;

const blogFolders = fs.readdirSync(BLOG_DIR, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

for (const slug of blogFolders) {
  const blogPath = path.join(BLOG_DIR, slug);
  const htmlPath = path.join(blogPath, 'index.html');
  const jsonPath = path.join(blogPath, 'index.json');

  if (!fs.existsSync(htmlPath) || !fs.existsSync(jsonPath)) {
    console.warn(`${YELLOW}Skipping ${slug}: missing index.html or index.json${RESET}`);
    continue;
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    console.error(`${RED}Error parsing ${slug}/index.json: ${err.message}${RESET}`);
    continue;
  }

  if (!meta?.title) {
    console.warn(`${YELLOW}Skipping ${slug}: index.json has no title${RESET}`);
    continue;
  }

  const rawHtml = fs.readFileSync(htmlPath, 'utf-8');
  const isDraft = Boolean(meta.draft);

  manifestPosts.push({
    slug,
    frontmatter: {
      title: meta.title,
      description: meta.description ?? '',
      publishedAt: meta.publishedAt ?? '',
      updatedAt: meta.updatedAt,
      draft: isDraft,
      tags: meta.tags ?? [],
      coverImage: meta.coverImage,
      coverAlt: meta.coverAlt,
      featured: Boolean(meta.featured),
      canonicalUrl: meta.canonicalUrl,
      author: meta.author,
    },
  });

  if (!isDraft) {
    publishedCount++;
    const cleanText = cleanHtmlText(rawHtml);
    searchEntries.push({
      type: 'blog',
      title: meta.title,
      subject: 'Blog',
      folderName: slug,
      slug,
      topicTitle: meta.description || '',
      text: cleanText,
      snippet: cleanText.slice(0, 300),
    });
  }

  const files = fs.readdirSync(blogPath).filter((name) => {
    if (name === 'index.html' || name === 'index.json') return true;
    return MEDIA_EXT.some((ext) => name.toLowerCase().endsWith(ext));
  });

  for (const fileName of files) {
    const localPath = path.join(blogPath, fileName);
    const remoteKey = `blog/${slug}/${fileName}`;
    const hash = getFileMd5(localPath);
    if (!FORCE_UPLOAD && uploadCache[remoteKey] === hash) {
      skippedCount++;
      continue;
    }
    uploadQueue.push({
      localPath,
      remoteKey,
      contentType: contentTypeFor(fileName),
      hash,
    });
  }
}

const timestamp = new Date().toISOString();
const versionHash = crypto.createHash('sha256').update(timestamp + String(manifestPosts.length)).digest('hex').substring(0, 16);

const manifest = {
  version: versionHash,
  updatedAt: timestamp,
  posts: manifestPosts,
};

const manifestPath = path.join(process.cwd(), '.blog-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
uploadQueue.push({
  localPath: manifestPath,
  remoteKey: 'blog-manifest.json',
  contentType: 'application/json',
});

const searchIndexPath = path.join(process.cwd(), '.search-index.json');
const remoteSearchPath = path.join(process.cwd(), '.search-index-remote.json');

function downloadSearchIndex() {
  try {
    execSync(
      `npx wrangler r2 object get "${BUCKET_NAME}/search-index.json" --file "${remoteSearchPath}" --remote`,
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

let mergedSearch = searchEntries;
if (downloadSearchIndex() && fs.existsSync(remoteSearchPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(remoteSearchPath, 'utf-8'));
    if (Array.isArray(existing)) {
      mergedSearch = existing.filter((item) => item?.type !== 'blog').concat(searchEntries);
      console.log(`Merged ${searchEntries.length} blog search entries into existing search index.`);
    }
  } catch {
    console.warn(`${YELLOW}Could not parse remote search-index.json; uploading blog entries only.${RESET}`);
  }
} else {
  console.warn(`${YELLOW}Could not download search-index.json from R2. Uploading blog entries only — run npm run upload-notes to restore lecture search.${RESET}`);
}

fs.writeFileSync(searchIndexPath, JSON.stringify(mergedSearch), 'utf-8');
uploadQueue.push({
  localPath: searchIndexPath,
  remoteKey: 'search-index.json',
  contentType: 'application/json',
});

console.log(`Found ${manifestPosts.length} blog post(s) (${publishedCount} published).`);
console.log(`Smart Sync Status: ${skippedCount} file(s) are already up-to-date and skipped.`);
console.log(`Queueing ${uploadQueue.length} files (including manifest & search index) to R2 bucket "${BUCKET_NAME}"...\n`);

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
  try {
    execSync(cmd, { stdio: 'ignore' });
    if (item.hash) updateCacheEntry(item.remoteKey, item.hash);
  } catch (err) {
    console.error(`${RED}Failed to upload ${item.remoteKey}: ${err.message}${RESET}`);
    throw err;
  }
}

try {
  await runWithLimit(8, uploadQueue, uploadFile);
  console.log(`\n${GREEN}${BOLD}Success! Blog sync to R2 completed.${RESET}`);
  console.log(`Published posts are live at /blog/{slug} (anonymous HTML cache may take up to 5 minutes).\n`);
} catch {
  console.error(`\n${RED}${BOLD}Blog sync completed with errors.${RESET}`);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  if (fs.existsSync(searchIndexPath)) fs.unlinkSync(searchIndexPath);
  if (fs.existsSync(remoteSearchPath)) fs.unlinkSync(remoteSearchPath);
}
