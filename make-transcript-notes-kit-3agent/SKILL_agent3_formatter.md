---
name: formatter
description: >-
  Phase 3 of make-transcript-notes-kit. Takes the enricher's annotated markdown draft
  and produces the final self-contained notes.html — converting callout annotations to
  HTML, embedding all SEO metadata inline, generating exam revision notes, running the
  lint gate, and self-scoring against the quality rubric. Output is a single HTML file
  with no companion JSON files. Trigger after Agent 2 (enricher).
---

# Agent 3 — Formatter

**Your job:** Take Agent 2's enriched markdown draft (with `:::` callout annotations) and produce the **final `notes.html`** — a self-contained, lint-clean, rubric-scored HTML page with all SEO, structured data, and lecture metadata embedded directly in the HTML. **No companion `.json` files are created.**

**Your input:** Agent 2's enriched markdown draft with callout annotations.

**Your output:** `output/<subject>/<lecture>/notes.html` — passes lint with zero FAILs, scores ≥ 85/100 against the rubric, zero red-list items. This is the ONLY file produced. All metadata is embedded in the HTML. The BitsNotes viewer reads the metadata from `<script id="lecture-metadata">` inside this single HTML file.

---

## Core rules for this phase

1. **Information density** — The final HTML must contain everything from Agent 2's draft. Do not thin it out. Preserve full depth.
2. **Math must render** — Single backslash delimiters only. Every symbol named. Wide formulas scroll horizontally (platform CSS handles this via `mjx-container`).
3. **No styling in the HTML** — No `<style>` tags, no inline `style=""`, no Google Fonts links. All styling comes from `/lecture-notes.css`.
4. **SEO must be complete** — Every SEO element is mandatory. The lint gate enforces this.
5. **Exam revision is a distillation, not an invention** — Built from the completed core only.
6. **STRIP intermediate metadata** — Before converting to HTML, strip any extraction checklists, quality self-checks, verification tick-lists, or other intermediate/process metadata that may have leaked from Agent 1 or Agent 2. These are NOT educational content. The HTML body must contain ONLY the textbook content and exam revision notes.
7. **Math is final and reconciled** — Agent 2 should have resolved every `*[verify]*` marker. If any remain (escalated by Agent 2 with a `:::warning-box`), preserve that warning callout in the HTML and keep the marker text out of the visible prose. The lint gate will WARN on leftover `*[verify]*` markers so they are not silently shipped. Exam revision `keyFormula` values must use Agent 2's reconciled LaTeX, not re-derived.

---

## Step 0 — Strip intermediate metadata (MANDATORY)

Before anything else, scan the enriched draft for intermediate/process metadata that MUST NOT appear in the final HTML. **Remove these entirely** — they are NOT educational content:

- **Extraction checklists** — any section titled "Extraction Checklist" with ticked/bulleted lists of concepts. These are Agent 1's internal verification and belong nowhere in the final output.
- **Quality self-check lists** — any section titled "Quality self-check" or "Quality self-check before handoff" with checkbox items. These are Agent 2's internal verification.
- **The math verification queue / marker sweep lists** — Agent 2's internal R-step work lists. These are process artifacts.
- **Any `*[verify]*` markers that Agent 2 resolved** — the marker text itself (`*[verify: ...]*`) must be removed from visible prose. Only markers that Agent 2 explicitly escalated inside a `:::warning-box` should remain, and even then only the human-readable warning prose — not the `*[verify: ...]*` token.
- **Any other process/verification metadata** — any section that reads like internal QA rather than educational material.

**How to identify:** Look for sections whose heading contains words like "checklist", "self-check", "verification", or sections that are just long bulleted/ticked lists of concept names with `[x]` markers. These have zero educational value for the end reader.

After stripping, the remaining content should start directly with the first educational concept section.

---

## Step 1 — Convert callout annotations to HTML

Agent 2's draft uses `:::` fenced blocks. Convert them:

```
:::key-concept           →  <div class="key-concept"> ... </div>
:::important-note        →  <div class="important-note"> ... </div>
:::example-box           →  <div class="example-box"> ... </div>
:::warning-box           →  <div class="warning-box"> ... </div>
:::key-takeaway          →  <div class="key-takeaway"> ... </div>
```

**Callout taxonomy (verify correctness):**

| CSS Class | Color | Use for |
|---|---|---|
| `.key-concept` | blue | Core definitions, foundational principles |
| `.important-note` | violet | Intuition, mental models, plain-language restatements |
| `.example-box` | green | Fully worked examples with real numbers |
| `.warning-box` | red | Pitfalls, traps, cautions, common mistakes |
| `.key-takeaway` | amber | One-line recap, bridge to next concept |

Plus structural classes: `.chapter-title` (h1), `.section-title` (h2), `.subsection-title` (h3).

**Rules:** No other callout types exist. No two same-type callouts back-to-back — separate with body text.

---

## Step 2 — Fill the HTML template

Use `templates/notes.html`. Replace every `{{PLACEHOLDER}}`:

| Placeholder | What to fill |
|---|---|
| `{{LECTURE_TITLE}}` | Descriptive lecture title |
| `{{SUBJECT}}` | Full subject name |
| `{{TITLE}}` | Same as LECTURE_TITLE |
| `{{DATE_PUBLISHED}}` | Today's date in YYYY-MM-DD |
| `{{GRADE_LEVEL}}` | e.g. "postgraduate" or "undergraduate" |
| `{{TARGET_AUDIENCE}}` | Who these notes are for |
| `{{SUMMARY_TEXT_PLAIN}}` | Plain-text summary, 100-155 chars — see SEO below |
| `{{KEYWORDS}}` | Comma-separated: subject name, lecture topic, all key concepts |
| `{{CANONICAL_URL}}` | `https://bitsnotes.com/<subject-slug>/<lecture-slug>` |
| `{{STRUCTURED_DATA_JSON}}` | Minified JSON-LD — see SEO below |
| `{{RAW_METADATA_JSON}}` | Full metadata JSON — see Step 3 below |
| `{{MAIN_TEXTBOOK_CONTENT}}` | The converted HTML from Step 1 |
| `{{EXAM_REVISION_NOTES}}` | Exam revision HTML — see Step 4 below |

---

## Step 3 — Generate embedded metadata (embedded in HTML, no separate file)

This metadata is placed inside `<script type="application/json" id="lecture-metadata">` in the HTML `<head>`. The BitsNotes viewer reads it directly from the HTML file — no companion `.json` file is created.

```json
{
  "title": "Descriptive lecture title",
  "subject": "Full subject name",
  "gradeLevel": "postgraduate",
  "datePublished": "YYYY-MM-DD",
  "targetAudience": "Who these notes are for",
  "summary": "Detailed multi-paragraph dense overview of the lecture content...",
  "keyConcepts": [
    "Objective 1: What will a student learn?",
    "Objective 2",
    "Objective 3"
  ],
  "sections": [
    { "title": "Section name", "description": "What this section covers" }
  ],
  "quiz": [
    {
      "question": "Multiple choice question?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "Why the correct answer is correct."
    }
  ],
  "examRevisionNotes": [
    {
      "topic": "Concept name",
      "mustKnow": "The single most examinable takeaway",
      "keyFormula": "\\[ central formula in LaTeX \\]",
      "commonPitfall": "The #1 exam mistake",
      "quickCheck": "One conceptual question the student should answer",
      "connections": ["Related concept 1", "Related concept 2"]
    }
  ]
}
```

**Rules:**
- `summary` must be detailed and dense (multiple paragraphs).
- `sections` must include every major concept from the core.
- `examRevisionNotes` — one entry per major concept. **Built ONLY from the completed core — never invented.** Every `keyFormula` must render correctly.

---

## Step 4 — Generate exam revision notes (AFTER core is complete)

Re-read the full core first. This section is a *distillation*, not a co-product.

Each entry = one `<div class="exam-revision-entry">`:

```html
<div class="exam-revision-entry">
  <h3 class="revision-topic">Concept Name</h3>
  <p class="revision-mustknow"><strong>Must-know:</strong> The single most examinable takeaway. Bold key terms.</p>
  <p class="revision-formula">\[ central formula — every symbol named \]</p>
  <p class="revision-pitfall"><strong>⚠️ Top pitfall:</strong> The #1 exam mistake students make.</p>
  <p class="revision-check"><strong>Self-check:</strong> One conceptual question — answerable in your head.</p>
  <p class="revision-connections"><strong>Connects to:</strong> Other concepts in this lecture.</p>
</div>
```

**Critical rules:**
- One entry per major concept.
- Every formula in `\[...\]` with every symbol named.
- **Use the reconciled formulas from Agent 2's enriched core** — do not re-derive or paraphrase. If the core shows two equivalent forms (professor's + standard), use the professor's form in `keyFormula` and mention the alternative in `mustKnow` if useful.
- **No content invented here** — everything must be traceable to the core.
- The intro paragraph: "Below is the distilled, exam-ready core of this lecture. Every entry is built from the full textbook notes above. Use this section for rapid review — but if something doesn't make sense, go back to the full explanation in the main content."

---

## Step 5 — SEO (all mandatory — lint enforces)

### Meta description
`<meta name="description" content="...">` — **100-155 characters**, unique per lecture, includes subject name + 2-3 key concepts naturally. Plain text only. No HTML tags.

### Open Graph (Facebook/LinkedIn previews)
```html
<meta property="og:type" content="article">
<meta property="og:title" content="LECTURE_TITLE | SUBJECT">
<meta property="og:description" content="SUMMARY_TEXT_PLAIN">
<meta property="og:url" content="CANONICAL_URL">
<meta property="og:image" content="https://bitsnotes.com/og-default.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="BitsNotes">
```

### Twitter Card
```html
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="LECTURE_TITLE | SUBJECT">
<meta name="twitter:description" content="SUMMARY_TEXT_PLAIN">
<meta name="twitter:image" content="https://bitsnotes.com/og-default.png">
<meta name="twitter:site" content="@BitsNotes">
```

### Other required tags
```html
<meta name="keywords" content="subject, topic, concept1, concept2, concept3">
<meta name="author" content="BitsNotes">
<meta name="robots" content="index, follow">
<link rel="canonical" href="CANONICAL_URL">
```

### JSON-LD structured data (minified)
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Lecture Title",
  "description": "100-155 char description",
  "datePublished": "YYYY-MM-DD",
  "author": { "@type": "Organization", "name": "BitsNotes" },
  "publisher": { "@type": "Organization", "name": "BitsNotes" },
  "educationalLevel": "postgraduate",
  "about": ["concept1", "concept2", "concept3"]
}
```

---

## Step 6 — Math quality check

- **Single backslash ONLY:** `\( ... \)` inline, `\[ ... \]` block. **Never `\\(` or `\\[`** — those render as literal backslash characters.
- **Every symbol named per chapter** — a student jumping to any chapter must understand every symbol.
- **Every derivation complete** — no line should read "after simplification" or skip algebra. If a step is genuinely out of scope, say so explicitly in prose; never silently omit.
- **Fraction hygiene:** `\frac{}{}` not inline `/`. **Exponent hygiene:** `e^{i\pi}` not `e^i\pi`.
- **Multi-line:** `\begin{aligned}` inside `\[ ... \]`.
- **No raw LaTeX leaking:** `\cdot` not `*`, `\times` not `x`, `\ldots` not `...`.
- **Tensor shapes stated** on first use for any vector/matrix/tensor formula.
- **No `*[verify]*` tokens in the visible body** — these are Agent 1/2 process markers. Remove resolved ones; convert escalated ones into `:::warning-box` prose. (The lint gate will WARN if any remain.)
- **Wide formulas** auto-scroll via platform CSS on `mjx-container` — no manual wrapper needed.

---

## Step 7 — Run the lint gate

```bash
python scripts/lint.py output/<subject>/<lecture>/notes.html
```

Fix **every FAIL**. Re-run until clean. WARNs don't block but usually flag real issues — fix them when possible.

The lint checks: template hygiene (no surviving `{{PLACEHOLDER}}`), viewport meta, metadata completeness, SEO (OG, Twitter, canonical, robots, keywords, JSON-LD, description length), callout box usage (all 5 types present), style separation (no `<style>`/inline `style`/Google Fonts), math delimiters (no `\\(`), PII/secrets, readability (sentence length), long tokens, exam revision entries, content structure.

---

## Step 8 — Self-score against the quality rubric

### Rubric (100 points)

| # | Category | Weight |
|---|----------|:------:|
| 1 | Completeness/coverage — every transcript concept present, every example fully worked | 14 |
| 2 | Teaching spine — all 9 steps per major concept, correct callout per step | 12 |
| 3 | Easy language — <~20 word sentences, terms defined on first use, common words | 10 |
| 4 | Relatable analogies — every tricky idea has concrete mapping analogy | 9 |
| 5 | Math intuition & display — built step by step, every symbol named, correct `\(`/`\[` delimiters | 13 |
| 6 | Generous worked examples — ≥1 fully-solved per concept, real numbers, every step, no "it can be shown" | 12 |
| 7 | Information density — no thin summaries, domain knowledge supplemented, standalone learnable | 10 |
| 8 | Readability & structure — clean h1/h2/h3 hierarchy, callout boxes correct, exam entries well-formed | 5 |
| 9 | Story/flow — hook opener, bridges between concepts, reads as one coherent text | 4 |
| 10 | SEO — OG tags, Twitter Cards, canonical, robots, keywords, JSON-LD, description 100-155 chars | 7 |
| 11 | Exam revision notes — one entry per major concept, built from core, all fields present | 4 |
| | **Total** | **100** |

**Banding:** 95-100 exemplary · 85-94 ship · 70-84 revise · <70 rebuild

### Red-list (any one = automatic fail regardless of score)

- Concept left out or transcript example not worked in full
- Worked example skips steps or says "it can be shown that"
- Math doesn't render (double-backslash `\\(` used)
- Formula in exam revision doesn't render or has unnamed symbols
- Domain connection missing from any major concept
- Long jargon-dense sentences — smart beginner gets lost
- PII present: names, institute, "transcript"/"lecture" references
- Summary thin — student can't learn from notes alone
- Callout box used for wrong purpose
- Professor's informal analogies replaced with generic LLM ones
- Exam revision entry contains info not in core content
- Unresolved `*[verify]*` marker in visible body (resolved markers must be removed; escalated ones converted to warning callouts)
- Derivation skips algebra steps or says "after simplification" without showing the simplification
- SEO absent/broken: missing description, OG/Twitter/JSON-LD, or description outside 100-155 chars

---

## Ship checklist (all must be ✓ before finishing)

- [ ] Every concept present in teaching order; every transcript example worked in full
- [ ] All 9 spine steps per major concept; correct callout per step
- [ ] Sampled paragraphs pass easy-language audit (avg <~20 words, terms defined on first use)
- [ ] Every tricky idea has concrete, mapping analogy
- [ ] Math: step-by-step, every symbol named, correct single-backslash delimiters, tensor shapes stated, every derivation complete with no skipped algebra
- [ ] No `*[verify]*` markers in visible body (resolved removed, escalated converted to warning callouts)
- [ ] Every worked example: all steps, real numbers, final highlighted, sense-check
- [ ] No thin summaries; domain knowledge supplemented
- [ ] Clean hierarchy; hook opener; bridges between concepts
- [ ] Anonymized: no PII; reads as standalone textbook
- [ ] Metadata JSON complete with examRevisionNotes
- [ ] Professor intuition preserved (analogies, stories, confusion flags — not generic substitutes)
- [ ] Exam revision: one entry per major concept, built from core only, every formula renders
- [ ] SEO: description 100-155 chars, unique, keyword-rich; OG, Twitter, canonical, robots, keywords, JSON-LD all present
- [ ] Lint passes with zero FAILs
- [ ] Score ≥ 85/100 and zero red-list items
