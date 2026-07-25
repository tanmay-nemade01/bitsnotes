import fs from 'node:fs';
import path from 'node:path';

const NOTES_DIR = path.join(process.cwd(), 'src/content/notes');

// Colors for console output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

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

  return {
    title: readableTitle,
    subject: subject
  };
}

function normalizeCatalogEntry({ folderName, fileName, name, metadata }) {
  const resourceKind = detectResourceKind(folderName, metadata);
  const topicTitle = deriveTopicTitle(folderName, metadata);
  return {
    slug: slugify(topicTitle),
    topicTitle
  };
}

function verifyCanonicalUrls() {
  console.log(`${BOLD}Checking lecture HTML canonical URLs against website routing format...${RESET}`);

  const subjectFolders = fs.readdirSync(NOTES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  let totalChecked = 0;
  const errors = [];

  for (const subjectName of subjectFolders) {
    const subjectPath = path.join(NOTES_DIR, subjectName);
    const lectureFolders = fs.readdirSync(subjectPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const lectureFolder of lectureFolders) {
      const lecturePath = path.join(subjectPath, lectureFolder);
      const files = fs.readdirSync(lecturePath);
      
      const htmlFile = files.find(f => f.endsWith('_notes_enhanced.html')) || files.find(f => f.endsWith('.html'));
      if (!htmlFile) continue;

      const htmlPath = path.join(lecturePath, htmlFile);
      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
      const fileName = htmlFile.replace(/\.html?$/i, '');
      const defaultDisplayName = fileName.replace(/_/g, ' ');

      let metadata = null;
      const jsonFile = files.find(f => f.endsWith('.json') && !f.endsWith('_enhancement_audit.json'));
      if (jsonFile) {
        try {
          metadata = JSON.parse(fs.readFileSync(path.join(lecturePath, jsonFile), 'utf-8'));
        } catch (err) {}
      }
      
      if (!metadata) {
        metadata = extractEmbeddedMetadata(htmlContent);
      }
      if (!metadata) {
        metadata = getFallbackMetadata(defaultDisplayName, subjectName);
      }

      const catalogEntry = normalizeCatalogEntry({
        folderName: lectureFolder,
        fileName,
        name: defaultDisplayName,
        metadata
      });

      const subjectSlug = slugify(subjectName);
      const expectedUrl = `https://bitsnotes.com/view/${subjectSlug}/${catalogEntry.slug}`;

      totalChecked++;

      // Check link rel="canonical"
      const canonicalMatch = htmlContent.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) ||
                             htmlContent.match(/<link\s+href=["']([^"']+)["']\s+rel=["']canonical["']/i);
      const canonicalUrl = canonicalMatch ? canonicalMatch[1] : null;

      // Check meta property="og:url"
      const ogUrlMatch = htmlContent.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i) ||
                         htmlContent.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:url["']/i);
      const ogUrl = ogUrlMatch ? ogUrlMatch[1] : null;

      const issues = [];
      if (!canonicalUrl) {
        issues.push('Missing <link rel="canonical"> tag');
      } else if (canonicalUrl !== expectedUrl) {
        issues.push(`Canonical URL mismatch: found "${canonicalUrl}", expected "${expectedUrl}"`);
      }

      if (ogUrl && ogUrl !== expectedUrl) {
        issues.push(`og:url mismatch: found "${ogUrl}", expected "${expectedUrl}"`);
      }

      if (issues.length > 0) {
        errors.push({
          file: path.relative(NOTES_DIR, htmlPath),
          expectedUrl,
          issues
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n${RED}${BOLD}Canonical URL Verification Failed! Found ${errors.length} issue(s) in ${totalChecked} files:${RESET}\n`);
    for (const err of errors) {
      console.error(`${YELLOW}File: ${err.file}${RESET}`);
      for (const issue of err.issues) {
        console.error(`  ${RED}• ${issue}${RESET}`);
      }
    }
    process.exit(1);
  } else {
    console.log(`${GREEN}${BOLD}✓ Canonical URL check passed: All ${totalChecked} lecture HTML files have canonical tags matching the website URL format.${RESET}\n`);
  }
}

verifyCanonicalUrls();
