import katex from 'katex';

/**
 * Server-side LaTeX → KaTeX HTML conversion.
 *
 * Replaces the client-side MathJax pipeline (620KB + seconds of main-thread
 * CPU) with math pre-rendered into static HTML. Supports the same delimiters
 * the notes were authored against:
 *
 *   Display:  `$$...$$`, `\[...\]`
 *   Inline:   `\(...\)`, `$...$`  (conservative `$` pairing)
 *
 * Like MathJax, math may span inline elements (`\(...\)` split across
 * `<th>`/`<span>` boundaries), so the scanner passes tags through untouched
 * and strips them from the math source. Content inside `<pre>`, `<code>`,
 * `<script>`, `<style>` and HTML comments is left untouched (MathJax v3
 * skips the same tags by default).
 */

const DISPLAY_PAIRS: Array<[string, string]> = [
  ['$$', '$$'],
  ['\\[', '\\]'],
];

const INLINE_PAIRS: Array<[string, string]> = [
  ['\\(', '\\)'],
  ['$', '$'],
];

const KATEX_OPTIONS_INLINE = {
  displayMode: false,
  throwOnError: true,
  strict: false,
  output: 'html' as const,
};

const KATEX_OPTIONS_DISPLAY = {
  ...KATEX_OPTIONS_INLINE,
  displayMode: true,
};

/** Regions of the document that must never be treated as math. */
const PROTECTED_REGION_RE =
  /<pre[^>]*>[\s\S]*?<\/pre>|<code[^>]*>[\s\S]*?<\/code>|<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;

/** Any HTML open/close tag (scanned, but never scanned *inside*). */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;

/** Control characters (incl. the NUL/CR bytes that transcript pipelines leak). */
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

/**
 * The notes' pipeline interpreted `\b`, `\r`, `\a`, ... escape sequences as
 * real control characters (`\begin` → BS+`egin`, `\right` → `\`+CRLF+`ight`,
 * `\alpha` → `\`+BEL+`lpha`). Reconstruct them:
 *
 *   1. `\\` + newline is a legit line break — kept as-is;
 *   2. a single `\` + newline + letter is a mangled `\r`;
 *   3. `\` + other control char + letter is a mangled `\X` (`\b`, `\a`, ...);
 *   4. control char (preceded by whitespace) + letter is a mangled `\X` that
 *      lost its backslash (`\begin` → BS+`egin`);
 *   5. newline (preceded by whitespace) + letter is a mangled `\r` that lost
 *      its backslash (`\right]` → CRLF+`ight]`).
 */
const MANGLED_CTRL_RE =
  /(\\{2})(\r\n|\r|\n)(?=[a-z])|(\\)(\r\n|\r|\n)(?=[a-z])|(\\)([\u0007\u0008\u000C\u0009\u000B])(?=[a-z])|(^|\s)([\u0007\u0008\u000C\u0009\u000B])(?=[a-z])|(^|\s)(\r\n|\r|\n)(?=[a-z])/g;

export function restoreMangledEscapes(tex: string): string {
  const LETTER: Record<string, string> = {
    '\u0007': 'a', // \a  (BEL)
    '\u0008': 'b', // \b  (backspace)
    '\u000C': 'f', // \f  (form feed)
    '\u0009': 't', // \t  (tab)
    '\u000B': 'v', // \v  (vertical tab)
  };
  return tex.replace(
    MANGLED_CTRL_RE,
    (m, dbl: string | undefined, _nl1: string, single: string | undefined, _nl2: string, s3: string | undefined, c3: string | undefined, pre: string | undefined, c4: string | undefined, pre2: string | undefined, _nl3: string) => {
      if (dbl !== undefined) return m; // legit `\\` line break
      if (single !== undefined) return '\\r'; // mangled `\r`
      if (s3 !== undefined) return '\\' + (LETTER[c3 ?? ''] ?? '');
      if (pre2 !== undefined) return (pre2 ?? '') + '\\r'; // mangled `\r`, backslash lost
      return (pre ?? '') + '\\' + (LETTER[c4 ?? ''] ?? '');
    },
  );
}

const SENTINEL_RE = /\u0000BN_P\d+\u0000/g;

/** Math-y HTML entities → the TeX/unicode KaTeX understands. */
const NAMED_ENTITIES: Record<string, string> = {
  lt: '\\lt ',
  gt: '\\gt ',
  amp: '\\& ',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  le: '\u2264', leq: '\u2264', ge: '\u2265', geq: '\u2265',
  ne: '\u2260', neq: '\u2260', times: '\u00D7', div: '\u00F7',
  middot: '\u00B7', sdot: '\u22C5', pm: '\u00B1', minus: '\u2212',
  in: '\u2208', notin: '\u2209', sum: '\u2211', prod: '\u2210',
  infin: '\u221E', radic: '\u221A', cap: '\u2229', cup: '\u222A',
  subset: '\u2282', supset: '\u2283', sube: '\u2286', supe: '\u2287',
  equiv: '\u2261', approx: '\u2248', sim: '\u223C', cong: '\u2245',
  circ: '\u2218', ominus: '\u2295', otimes: '\u2297', emptyset: '\u2205',
  nabla: '\u2207', partial: '\u2202', forall: '\u2200', exist: '\u2203',
  neg: '\u00AC', int: '\u222B', prime: '\u2032', deg: '\u00B0',
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4',
  epsilon: '\u03F5', theta: '\u03B8', lambda: '\u03BB', mu: '\u03BC',
  pi: '\u03C0', sigma: '\u03C3', phi: '\u03C6', omega: '\u03C9',
  tau: '\u03C4', xi: '\u03BE', zeta: '\u03B6', eta: '\u03B7',
  iota: '\u03B9', kappa: '\u03BA', nu: '\u03BD', rho: '\u03C1',
  upsilon: '\u03C5', chi: '\u03C7', psi: '\u03C8', ell: '\u2113',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B',
  Pi: '\u03A0', Sigma: '\u03A3', Phi: '\u03A6', Omega: '\u03A9',
  Psi: '\u03A8', Xi: '\u039E',
};

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);?/g;

/** `\text{...}` groups (one level of nested braces) — entities decode differently there. */
const TEXT_GROUP_RE = /\\text\{((?:[^{}]|\{[^{}]*\})*)\}/g;

/**
 * Decode HTML entities inside math source (MathJax did this implicitly).
 * `&lt;`/`&gt;` map to `\lt ` in math mode but `\textless `/`\textgreater `
 * inside `\text{...}` (where `\lt` is undefined).
 */
function decodeMathEntities(tex: string): string {
  const decodeRun = (s: string, textMode: boolean): string =>
    s.replace(ENTITY_RE, (m, ent: string) => {
      if (ent[0] === '#') {
        const isHex = ent[1] === 'x' || ent[1] === 'X';
        const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x10FFFF ? String.fromCharCode(code) : m;
      }
      const mapped = NAMED_ENTITIES[ent];
      if (mapped === undefined) return m;
      if (textMode) {
        if (ent === 'lt') return '\\textless ';
        if (ent === 'gt') return '\\textgreater ';
        if (ent === 'amp') return '\\& ';
      }
      return mapped;
    });

  let out = '';
  let last = 0;
  for (const match of tex.matchAll(TEXT_GROUP_RE)) {
    out += decodeRun(tex.slice(last, match.index), false);
    out += '\\text{' + decodeRun(match[1], true) + '}';
    last = match.index + match[0].length;
  }
  return out + decodeRun(tex.slice(last), false);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sanitize `\text{...}` groups: KaTeX rejects bare `_` and `#` there, and
 * the generator writes `\lt s\gt` (meant as literal `<s>`) which is
 * undefined in text mode.
 */
function sanitizeTextGroups(tex: string): string {
  return tex.replace(TEXT_GROUP_RE, (m, inner: string) =>
    '\\text{' +
    inner
      .replace(/_/g, '\\_')
      .replace(/#/g, '\\#')
      .replace(/\\lt\b/g, '\\textless')
      .replace(/\\gt\b/g, '\\textgreater') +
    '}',
  );
}

/**
 * The notes' generator escapes parens/brackets inside display math
 * (`E\[X\]`, `\text{ \(success\)}`). KaTeX rejects these sequences in math
 * mode, so retry with them unescaped (they can never be valid math there).
 * A `\\` line break must not be mangled, so it is parked first.
 */
function unescapeDelimiters(tex: string): string {
  const sentinel = '\u0001BNBS\u0001';
  return tex
    .replace(/\\\\/g, sentinel)
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .split(sentinel)
    .join('\\\\');
}

/**
 * Render a formula, degrading gracefully instead of showing red error boxes:
 *   1. render as-is
 *   2. retry with control characters stripped (NUL/CR bytes etc.)
 *   3. retry with escaped delimiters unescaped (`E\[X\]` → `E[X]`)
 *   4. retry after dropping a stray trailing `}` (transcription typo)
 *   5. retry with `\text{...}` groups sanitized (`_`, `#`, `\lt`, `\gt`)
 *   6. retry with bare `<`/`>` mapped to `\lt`/`\gt` (MathJax accepted them)
 *   7. fall back to the escaped literal source text
 */
function safeRender(tex: string, options: typeof KATEX_OPTIONS_INLINE): string {
  const restored = restoreMangledEscapes(tex);
  const unescaped = unescapeDelimiters(restored);
  const attempts = [
    tex,
    restored,
    unescaped,
    unescaped.replace(/\}\}$/, '}'),
    sanitizeTextGroups(unescaped),
    sanitizeTextGroups(unescaped.replace(/\}\}$/, '}')),
    unescaped
      .replace(/<=/g, '\\le ')
      .replace(/>=/g, '\\ge ')
      .replace(/<(?![a-zA-Z])/g, '\\lt ')
      .replace(/>(?![a-zA-Z])/g, '\\gt '),
    // Escaped periods (`\.`) — corrupted decimal points from the generator.
    unescaped.replace(/\\\./g, '.'),
    // `\\alpha`, `\\right]` — the pipeline doubled a single command
    // backslash (`\\` directly before a letter is never a legit line break,
    // which always has a space or `[4pt]` spacing option after it).
    unescaped.replace(/\\\\(?=[a-z])/g, '\\'),
    tex.replace(CONTROL_CHARS_RE, ''),
  ];
  for (const candidate of attempts) {
    try {
      return katex.renderToString(candidate, options);
    } catch {
      /* try next leniency level */
    }
  }
  return `<span class="bn-math-literal">${escapeHtml(cleanMathSource(tex).replace(CONTROL_CHARS_RE, ''))}</span>`;
}

/**
 * `$...$` must stay conservative to avoid mangling currency amounts and
 * stray dollar signs: require a same-line pair with non-empty content that
 * does not start with a digit (e.g. "$5.99") or whitespace.
 */
function isInlineDollarCandidate(tex: string): boolean {
  if (!tex || tex.length === 0) return false;
  const first = tex[0];
  if (/\s|\d/.test(first)) return false;
  return tex.trim().length > 0;
}

/**
 * Clean math source extracted from the document: strip any HTML tags the
 * delimiters spanned across, decode entities, and drop placeholder sentinels.
 */
function cleanMathSource(tex: string): string {
  return decodeMathEntities(tex.replace(HTML_TAG_RE, '').replace(SENTINEL_RE, ''));
}

/**
 * Find the end of a math run, MathJax-style:
 *  - `{` / `}` track brace depth (a close delimiter inside `\frac{...}`
 *    or `\text{...}` does not end the run);
 *  - a nested occurrence of the SAME open delimiter increments depth and the
 *    matching same close decrements it — this handles the notes' generator
 *    habit of escaping brackets inside display math (`E\[X\]` stays inside
 *    the `\[...\]` run, instead of MathJax's naive first-match close);
 *  - `\[` followed by a digit or sign is a line-break spacing option
 *    (`\[4pt]` from the generator dropping a backslash), not a real open.
 * Returns the index of the closing delimiter, or -1.
 */
function findClosing(run: string, open: string, close: string, start: number): number {
  let i = start;
  let braces = 0;
  let depth = 0;
  const n = run.length;
  while (i < n) {
    // Close is checked before open so `$$...$$` (open === close) works.
    if (run.startsWith(close, i)) {
      if (braces === 0) {
        if (depth === 0) return i;
        depth--;
      }
      i += close.length;
      continue;
    }
    if (run.startsWith(open, i)) {
      const next = run[i + open.length];
      const isSpacingOption = open === '\\[' && next !== undefined && /[-\d]/.test(next);
      if (braces === 0 && !isSpacingOption) depth++;
      i += open.length;
      continue;
    }
    const c = run[i];
    if (c === '{') braces++;
    else if (c === '}' && braces > 0) braces--;
    i++;
  }
  return -1;
}

/**
 * Convert a text run (may contain HTML tags; tags are passed through but
 * never scanned inside) in a single left-to-right pass.
 */
function renderTextRun(run: string): string {
  let out = '';
  let i = 0;
  const n = run.length;

  while (i < n) {
    // Pass tags through untouched (never scan inside attributes).
    if (run[i] === '<') {
      const tag = run.slice(i).match(HTML_TAG_RE);
      if (tag && tag.index === 0) {
        out += tag[0];
        i += tag[0].length;
        continue;
      }
    }

    // `\\` (line break) — consume as a pair so the second backslash cannot
    // pair with a following `[` or `(` to fake a math delimiter (`\\[4pt]`).
    if (run[i] === '\\' && run[i + 1] === '\\') {
      out += '\\\\';
      i += 2;
      continue;
    }

    // Escaped dollar sign — keep as literal text.
    if (run[i] === '$' && i > 0 && run[i - 1] === '\\') {
      out += '$';
      i++;
      continue;
    }

    let converted = false;

    for (const [left, right] of DISPLAY_PAIRS) {
      if (run.startsWith(left, i)) {
        const end = findClosing(run, left, right, i + left.length);
        if (end !== -1) {
          out += safeRender(cleanMathSource(run.slice(i + left.length, end)), KATEX_OPTIONS_DISPLAY);
          i = end + right.length;
          converted = true;
          break;
        }
      }
    }
    if (converted) continue;

    for (const [left, right] of INLINE_PAIRS) {
      if (!run.startsWith(left, i)) continue;
      if (left === '$') {
        const newline = run.indexOf('\n', i + 1);
        const end = run.indexOf('$', i + 1);
        if (end === -1 || (newline !== -1 && newline < end)) break;
        const tex = run.slice(i + 1, end);
        if (!isInlineDollarCandidate(tex)) break;
        out += safeRender(cleanMathSource(tex), KATEX_OPTIONS_INLINE);
        i = end + 1;
        converted = true;
        break;
      }
      const end = findClosing(run, left, right, i + left.length);
      if (end !== -1) {
        out += safeRender(cleanMathSource(run.slice(i + left.length, end)), KATEX_OPTIONS_INLINE);
        i = end + right.length;
        converted = true;
        break;
      }
    }
    if (converted) continue;

    out += run[i];
    i++;
  }

  return out;
}

/**
 * Convert all LaTeX math in a lecture HTML document to KaTeX-rendered HTML.
 * Idempotent: content that already contains KaTeX spans is returned as-is.
 */
export function renderMathInHtml(html: string): string {
  if (!html || /class="katex"/.test(html)) return html;

  const protectedRuns: string[] = [];
  const textParts: string[] = [];
  let lastIndex = 0;

  for (const match of html.matchAll(PROTECTED_REGION_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    textParts.push(html.slice(lastIndex, start));
    protectedRuns.push(match[0]);
    textParts.push(`\u0000BN_P${protectedRuns.length - 1}\u0000`);
    lastIndex = end;
  }
  textParts.push(html.slice(lastIndex));

  const converted = textParts
    .map((part) =>
      /^\u0000BN_P\d+\u0000$/.test(part)
        ? protectedRuns[Number(part.replace(/\D/g, ''))]
        : renderTextRun(part),
    )
    .join('');

  return converted;
}

/**
 * Convert math inside a plain text string (metadata fields like quiz
 * questions, formulas, summaries). No-op when no delimiters are present.
 */
export function renderMathInline(text: string): string {
  if (!text || /class="katex"/.test(text)) return text;
  return renderTextRun(text);
}

/** Does this text contain any math delimiters we would convert? */
export function containsMath(text: string): boolean {
  return /\\\(|\\\[|\$\$|\$[^$]/.test(text);
}
