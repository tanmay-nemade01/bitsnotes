#!/usr/bin/env node
/**
 * audit-theme-colors.mjs
 *
 * Scans the controlled source for hard-coded colors that would break the
 * BitsNotes dark/light theme system. The theme is driven entirely by CSS
 * custom properties (design tokens) defined in `src/styles/tokens.css` and
 * bridged into Tailwind utilities via `src/styles/global.css`.
 *
 * Any literal color that is NOT on the documented allowlist fails the build
 * (the "audit gate"). This prevents regressions where a new white card or
 * dark-on-dark text sneaks into dark mode.
 *
 * Scanned:
 *   - src (all .astro and .css files)
 *   - public (all .css files)
 *   - src/content/notes (all .html lecture files — reported, not failed)
 *
 * Lecture content (src/content/notes/**) is REPORTED but does not fail the
 * build: those files are authored notes that ship their own <style> blocks.
 * They are scoped to `.lecture-notes-wrapper` at parse time (see
 * src/utils/htmlParser.ts) and the canonical lecture-notes.css is loaded
 * AFTER them so theme tokens win. We still surface them so they can be
 * cleaned up over time.
 *
 * Usage:
 *   node scripts/audit-theme-colors.mjs            # fail on violations
 *   node scripts/audit-theme-colors.mjs --report   # report only, exit 0
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const reportOnly = process.argv.includes('--report');

// ---------------------------------------------------------------------------
// Allowlist — documented exceptions from the implementation plan (Phase 1.4)
// ---------------------------------------------------------------------------
// Each entry is either an exact literal (matched case-insensitively) or a
// prefix (matched at the start of the detected color). Prefixes cover rgba()
// values whose alpha varies (e.g. rgba(255, 255, 255, 0.35) vs 0.10).

// 1. Official brand logo fills (Google "G", GitHub mark). Fixed brand colors.
const BRAND_LOGO_PATTERNS = [
  '#4285F4', '#34A853', '#FBBC05', '#EA4335', // Google
  '#24292f', '#2f3337',                        // GitHub button treatment
];

// 2. Permanent dark Pomodoro break overlay (intentional, never themed).
const POMODORO_BREAK_PATTERNS = [
  'rgba(10, 18, 18, 0.78)',
  'rgba(10, 10, 15, 0.92)',
  '#f1f5f9', '#f8fafc', '#fff', 'rgba(255, 255, 255',
];

// 3. Syntax / code colors deliberately designed to read on both themes
//    (dark code surface). Live in lecture-notes.css and Pomodoro.
const CODE_COLOR_PATTERNS = [
  '#0b0f19', '#0B0F19', '#f1f5f9', '#F1F5F9', '#1e293b', '#1E293B',
  '#0f172a', '#e2e8f0', '#22c55e', '#059669', '#D97706',
  'rgba(34, 197, 94', 'rgba(16, 185, 129', '#34d399',
  '#5eead4', 'rgba(45, 212, 191', 'rgba(15, 118, 110',
  'rgba(99, 102, 241', '#6366f1',
];

// 4. Theme bootstrap meta-color literals (light/dark paper). Mirror the
//    tokens; used only to set <meta name="theme-color"> before paint.
const THEME_META_PATTERNS = ['#FAF9F6', '#16140F'];

// 5. Neutral shadows / scrims / ripple tints. These are low-alpha overlays
//    that read acceptably on both themes (subtle elevation, ripple on accent
//    buttons, nav-progress shimmer). Documented as intentional.
const NEUTRAL_OVERLAY_PATTERNS = [
  'rgba(0, 0, 0',   // neutral shadows / scrims (low alpha)
  'rgba(0,0,0',     // same, no spaces
  'rgba(255, 255, 255', // light ripple / shimmer on accent (low alpha)
  'rgba(255,255,255',   // same, no spaces
  'rgb(255, 255, 255',  // ripple color check on white-text targets
  'rgb(255,255,255',    // same, no spaces
  '#333',           // print-only disabled message
];

// 8. Deterministic avatar palette (CommentsSection.astro). These are
//    decorative per-user avatar background fills chosen by a hash of the
//    display name. They are intentional brand-adjacent accent colors that
//    read acceptably on both themes and are not part of the chrome theme
//    system, so they are allowlisted rather than converted to tokens.
const AVATAR_PALETTE_PATTERNS = [
  '#0F766E', '#7C3AED', '#DB2777', '#D97706', '#2563EB', '#059669', '#DC2626', '#4F46E5',
];

// 9. Runtime string comparisons in JS (not color assignments). The ripple
//    handler in BaseLayout.astro inspects computed text color to pick a
//    ripple tint; these are string literals compared at runtime, not colors.
const RUNTIME_COMPARE_PATTERNS = [
  "indexOf('255, 255, 255')",
  "=== 'white'",
  "=== 'rgb(255, 255, 255)'",
];

// 6. The design-token file itself (tokens.css) is the source of truth and is
//    excluded from the scan entirely.

// 7. Email / API HTML strings (src/lib/auth/email.ts, src/pages/api/*) are
//    rendered outside the themed SPA (transactional emails, confirm pages)
//    and intentionally use fixed brand colors. Excluded from the scan.

// Combine all allowlisted literals + prefixes (case-insensitive compare).
const ALLOWED_LITERALS = new Set([
  ...BRAND_LOGO_PATTERNS,
  ...POMODORO_BREAK_PATTERNS,
  ...CODE_COLOR_PATTERNS,
  ...THEME_META_PATTERNS,
  ...NEUTRAL_OVERLAY_PATTERNS,
  ...AVATAR_PALETTE_PATTERNS,
].map((s) => s.toLowerCase()));

// A literal is allowed if it exactly matches an entry OR starts with an
// allowlisted prefix (covers rgba() alphas that vary).
function isAllowedLiteral(literal) {
  const lower = literal.toLowerCase();
  if (ALLOWED_LITERALS.has(lower)) return true;
  for (const entry of ALLOWED_LITERALS) {
    if (entry.endsWith('(') || entry.startsWith('rgba(') || entry.startsWith('#')) {
      if (lower.startsWith(entry)) return true;
    }
  }
  return false;
}

// Files / globs to skip entirely.
const SKIP_FILES = new Set([
  join(ROOT, 'src', 'styles', 'tokens.css'),
  join(ROOT, 'src', 'lib', 'auth', 'email.ts'),
]);
const SKIP_DIRS = [
  join(ROOT, 'src', 'pages', 'api'), // transactional email HTML strings
  join(ROOT, 'node_modules'),
  join(ROOT, '.astro'),
  join(ROOT, 'dist'),
];

// ---------------------------------------------------------------------------
// Color matchers
// ---------------------------------------------------------------------------

// hex: #fff, #FFFFFF, #FFF (3/4/6/8 digits)
const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
// rgb() / rgba()
const RGB_RE = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/gi;
// hsl() / hsla()
const HSL_RE = /hsla?\(\s*[\d.]+\s*,\s*[\d.]+\s*%?\s*,\s*[\d.]+\s*%?\s*(?:,\s*[\d.]+\s*)?\)/gi;
// bare color keywords (exclude `white-space` which is a CSS property, not a color)
const KEYWORD_RE = /\b(?:white|black)\b(?!-space)/gi;

/**
 * Check a single line. Returns array of violation strings (or []).
 * `allowVarFallback` — if true, a `var(--token, literal)` usage is allowed.
 */
function auditLine(line, allowVarFallback) {
  const violations = [];

  // Skip lines that are runtime string comparisons (not color assignments).
  if (RUNTIME_COMPARE_PATTERNS.some((p) => line.includes(p))) {
    return violations;
  }

  const checkLiteral = (lit) => {
    if (isAllowedLiteral(lit)) return;
    if (allowVarFallback && /var\(\s*--/.test(line)) return; // fallback inside var()
    violations.push(lit);
  };

  let m;
  while ((m = HEX_RE.exec(line)) !== null) checkLiteral(m[0]);
  HEX_RE.lastIndex = 0;
  while ((m = RGB_RE.exec(line)) !== null) checkLiteral(m[0]);
  RGB_RE.lastIndex = 0;
  while ((m = HSL_RE.exec(line)) !== null) checkLiteral(m[0]);
  HSL_RE.lastIndex = 0;
  while ((m = KEYWORD_RE.exec(line)) !== null) {
    // Allow `white-space`, `blackhole` etc. via word boundary already; but
    // `white`/`black` as keywords are flagged unless part of a var() fallback.
    if (allowVarFallback && /var\(\s*--/.test(line)) continue;
    violations.push(m[0]);
  }
  KEYWORD_RE.lastIndex = 0;

  return violations;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function walk(dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (SKIP_DIRS.some((d) => full === d || full.startsWith(d + '/'))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.includes(extname(full).toLowerCase())) {
      out.push(full);
    }
  }
}

function main() {
  const astroFiles = [];
  const cssFiles = [];
  walk(join(ROOT, 'src'), ['.astro', '.css'], astroFiles);
  walk(join(ROOT, 'public'), ['.css'], cssFiles);
  const noteFiles = [];
  walk(join(ROOT, 'src', 'content', 'notes'), ['.html'], noteFiles);

  const controlled = [...astroFiles, ...cssFiles].filter((f) => !SKIP_FILES.has(f));

  let failCount = 0;
  const report = [];

  for (const file of controlled) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const fileViolations = [];
    lines.forEach((line, idx) => {
      // In controlled source, var() fallbacks are acceptable.
      const v = auditLine(line, true);
      for (const lit of v) {
        fileViolations.push({ line: idx + 1, lit });
      }
    });
    if (fileViolations.length) {
      failCount += fileViolations.length;
      report.push({ file: file.replace(ROOT + '/', ''), violations: fileViolations });
    }
  }

  // Lecture content: report only (never fails the build).
  const noteReport = [];
  for (const file of noteFiles) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const fileViolations = [];
    lines.forEach((line, idx) => {
      const v = auditLine(line, false);
      for (const lit of v) fileViolations.push({ line: idx + 1, lit });
    });
    if (fileViolations.length) {
      noteReport.push({ file: file.replace(ROOT + '/', ''), violations: fileViolations });
    }
  }

  // ---- Output ----
  console.log('\n🔎 BitsNotes theme-color audit\n');

  if (report.length === 0) {
    console.log('✅ No unapproved hard-coded colors in controlled source.');
  } else {
    console.log(`❌ ${failCount} unapproved hard-coded color(s) in controlled source:\n`);
    for (const r of report) {
      console.log(`  ${r.file}`);
      for (const v of r.violations) {
        console.log(`    line ${v.line}: ${v.lit}`);
      }
    }
  }

  if (noteReport.length) {
    const total = noteReport.reduce((a, r) => a + r.violations.length, 0);
    console.log(`\nℹ️  ${total} hard-coded color(s) in lecture content (report only):`);
    for (const r of noteReport) {
      const sample = r.violations.slice(0, 3).map((v) => v.lit).join(', ');
      const more = r.violations.length > 3 ? ` (+${r.violations.length - 3} more)` : '';
      console.log(`  ${r.file}: ${sample}${more}`);
    }
    console.log('   (Lecture styles are scoped to .lecture-notes-wrapper and overridden by');
    console.log('    canonical lecture-notes.css loaded after content — see htmlParser.ts.)');
  }

  console.log('');

  if (failCount > 0 && !reportOnly) {
    console.error('Build gate: theme audit FAILED. Replace literals with design tokens.');
    process.exit(1);
  }
  if (reportOnly) {
    process.exit(0);
  }
  process.exit(0);
}

main();
