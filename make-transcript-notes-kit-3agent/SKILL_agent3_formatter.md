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

**Critical: Section-by-section processing.** The enriched draft sections are already split by the workflow. You will process **one pre-split enriched markdown section file at a time** in the `_sections/` directory, converting each section to HTML independently, then mechanically reassembling them. This keeps heading numbering local and prevents cross-section interference.

**Your input:** A directory `_sections/` containing:
- `_inventory.json` — the locked heading numbering map.
- `section_00_preamble.md` (if it exists).
- `section_XX.md` — pre-split enriched markdown concept and appendix files (containing `:::` callout annotations).

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
8. **Strict File Attachment Guard Rail** — Focus *only and only* on the files attached to the prompt/context. Do *not* search for or read other files in the workspace (such as other drafts or notes) unless you are absolutely certain that the attached files do not match the expected context at all (e.g., they are completely blank, corrupted, or clearly belong to a different course/lecture, suggesting an accidental attachment). Only under that absolute certainty may you check for other files in the workspace; otherwise, restrict your processing strictly to the attached files (while allowing necessary reads of templates/notes.html and the single topic_mappings/<Subject>.yaml file for the subject as instructed in Step 8).
9. **Strict Script Creation Guard Rail** — You are strictly prohibited from creating or writing any script (Python, Bash, JS, etc.) inside the toolkit folder (`make-transcript-notes-kit-3agent` or its subfolders) during the process. Any intermediate or temporary scripts created in the workspace for testing or content parsing must be cleaned up and deleted before completing the task.

---

## Step 0 — Strip intermediate metadata (MANDATORY)

Before anything else, scan the enriched draft for intermediate/process metadata that MUST NOT appear in the final HTML. **Remove these entirely** — they are NOT educational content:

- **Extraction checklists** — any section titled "Extraction Checklist" with ticked/bulleted lists of concepts. These are Agent 1's internal verification and belong nowhere in the final output.
- **Quality self-check lists** — any section titled "Quality self-check" or "Quality self-check before handoff" with checkbox items. These are Agent 2's internal verification.
- **The math verification queue / marker sweep lists** — Agent 2's internal R-step work lists. These are process artifacts.
- **Any `*[verify]*` markers that Agent 2 resolved** — the marker text itself (`*[verify: ...]*`) must be removed from visible prose. Only markers that Agent 2 explicitly escalated inside a `:::warning-box` should remain, and even then only the human-readable warning prose — not the `*[verify: ...]*` token.
- **Any other process/verification metadata** — any section that reads like internal QA rather than educational material.

**How to identify:** Look for sections whose heading contains words like "checklist", "self-check", "verification", or sections that are just long bulleted/ticked lists of concept names with `[x]` markers. These have zero educational value for the end reader.

**Do NOT strip educational appendices.** Agent 1 produces two consolidated content sections — "Exam Guidance Summary" and "Key Industry Applications" — and Agent 2 carries them through. These are legitimate educational content (the professor's exam strategy and real-world connections), NOT process metadata. Preserve and render them as normal sections. Only strip the internal checklists/self-checks listed above.

After stripping, the remaining content should start directly with the first educational concept section.

---

## Step 1 — Read the pre-split sections and inventory

The enriched draft is already split into sections under `output/<subject>/<lecture>/_sections/` before you run.

**Read `_inventory.json` immediately** from that directory. This is your contract. Every heading number is already assigned — you do NOT compute or renumber headings during conversion. If the inventory says section 3 has subsections 3.1, 3.2, 3.3, those are the exact numbers you use.


---

## Step 2 — Convert each section to HTML (ONE AT A TIME)

**Process sections sequentially.** For each `section_NN.md` file (in numeric order, starting from `section_01.md`):

### 2a — Strip intermediate metadata from this section

Apply the same rules as Step 0, but scoped to this section only. Remove extraction checklists, quality self-checks, verification tick-lists, and resolved `*[verify]*` markers that appear within this section's boundaries.

### 2b — Convert callout annotations to HTML

Same conversion rules as before, applied to this section only:

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
| `.important-note` | violet | Intuition, mental models, plain-language restatements, **student Q&A** (labeled `**Q:**`/`**A:**`) |
| `.example-box` | green | Fully worked examples with real numbers, procedure traces |
| `.warning-box` | red | Pitfalls, traps, cautions, common mistakes, **assumptions & scope** (labeled `**Scope:**`/`**Assumption:**`) |
| `.key-takeaway` | amber | One-line recap, bridge to next concept, **per-concept exam guidance** (labeled `**Exam note:**`) |

Plus structural classes: `.chapter-title` (h1), `.section-title` (h2), `.subsection-title` (h3).

**Rules:** No other callout types exist — situational spine content reuses these five with bold labels. No two same-type callouts back-to-back — separate with body text.

### 2c — Fix heading numbers against the inventory

**This is the critical step that prevents numbering drift.** Before writing the HTML:

1. Look up this section's number in `_inventory.json` (e.g., section 3 → `"num": 3`).
2. The `##` heading MUST use exactly `2. <Title>` format (the inventory title already includes the number).
3. Every `###` subsection MUST use exactly `2.X <Title>` where X matches the `sub_num` in the inventory.
4. **Never renumber.** If the markdown says `## 2.3 Some Topic` but the inventory says this is section 4, use `4. Some Topic`. The inventory is authoritative.

### 2d — Math quality check (per section)

- **Single backslash ONLY:** `\( ... \)` inline, `\[ ... \]` block. **Never `\\(` or `\\[`**.
- **Every symbol named** within this section — a student jumping to any section must understand every symbol.
- **Fraction hygiene:** `\frac{}{}` not inline `/`. **Exponent hygiene:** `e^{i\pi}` not `e^i\pi`.
- **Multi-line:** `\begin{aligned}` inside `\[ ... \]`.
- **No raw LaTeX leaking:** `\cdot` not `*`, `\times` not `x`, `\ldots` not `...`.
- **No `*[verify]*` tokens in visible body** — remove resolved ones; convert escalated ones into `:::warning-box` prose.

### 2e — Write the section HTML

Write the converted HTML to `section_NN.html` in the same `_sections/` directory. The file must contain ONLY the HTML for this section — no `<html>`, `<head>`, or `<body>` tags. Just the content that will go inside `<main>`.

### 2f — Move to the next section

Repeat 2a-2e for every `section_NN.md` file. Do NOT process multiple sections in parallel — each gets its own focused conversion pass.

### 2g — Convert the preamble (if it exists)

If `section_00_preamble.md` exists, convert it to `section_00_preamble.html` using the same rules. The preamble typically contains the lecture title (h1) and introductory paragraphs.

---

## Step 3 — Assemble the body HTML

Once ALL sections are converted, mechanically reassemble them:

```bash
python scripts/section_splitter.py assemble \
    output/<subject>/<lecture>/_sections/ \
    --output output/<subject>/<lecture>/_body.html
```

This concatenates all `section_*.html` files in inventory order. **No content changes during assembly** — it is purely mechanical concatenation. Read `_body.html` to get the `{{MAIN_TEXTBOOK_CONTENT}}` value.

After successful assembly, clean up the intermediate section files:

```bash
# Remove the _sections working directory
Remove-Item -Recurse -Force output/<subject>/<lecture>/_sections/
# Remove the temporary body file after template fill
Remove-Item -Force output/<subject>/<lecture>/_body.html
```

---

## Step 4 — Fill the HTML template

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
| `{{RAW_METADATA_JSON}}` | Full metadata JSON — see Step 5 below |
| `{{PREREQUISITE_KNOWLEDGE}}` | Optional HTML for "Previously covered" section — see Step 8 (Topic Mapping) |
| `{{MAIN_TEXTBOOK_CONTENT}}` | The assembled body HTML from `_body.html` (Step 3) |
| `{{EXAM_REVISION_NOTES}}` | Exam revision HTML — see Step 6 below |

### Filling the Prerequisite Knowledge section

This is populated by Step 8 (Topic Mapping) below. If no YAML file exists for this subject (new subject) or no previous lectures cover overlapping topics, set `{{PREREQUISITE_KNOWLEDGE}}` to an empty string and the section will be omitted.

```html
<section class="prerequisite-section">
  <h2>Prerequisite Knowledge</h2>
  <p class="prerequisite-intro">This lecture builds on the following
  concepts from earlier lectures. If any feel unfamiliar, review the
  linked notes before proceeding.</p>

  <div class="prerequisite-entry">
    <h3>Previously Covered in This Subject</h3>
    <ul>
      <li><strong>Concept</strong> — covered in Lecture N</li>
    </ul>
  </div>
</section>
```

---

## Step 5 — Generate embedded metadata (embedded in HTML, no separate file)

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

## Step 6 — Generate exam revision notes (AFTER core is complete)

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

## Step 7 — SEO (all mandatory — lint enforces)

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

## Step 8 — Topic Mapping (same-subject only)

This step reads the topic mapping YAML for the **same subject only**, generates the prerequisite HTML section, and writes back this lecture's topics.

### 8.1 — Find the YAML file for this subject

Look for `topic_mappings/<Subject>.yaml`. The filename may use an acronym (e.g., `ML.yaml` for "Machine Learning"). The helper function `load_topic_map()` in `scripts/topic_mapping_utils.py` handles this — it tries the direct filename first, then falls back to scanning all YAML files and matching by the `subject_name` field inside each file.

**If no YAML file exists for this subject** (new subject with no prior lectures):
- Set `{{PREREQUISITE_KNOWLEDGE}}` to an empty string (section will be omitted)
- Skip to Step 8.4 (write-back) to create the YAML file for this subject

**Do NOT scan other subjects' YAML files.** Cross-subject prerequisite detection is not part of this step.

### 8.2 — Identify previously covered topics

From the YAML, get the `topics_covered` lists from all **previous** lectures (lecture numbers lower than the current one). Compare them against the major topics in the completed HTML core (the h2/h3 section headings).

For each topic in the current lecture that matches a topic from a previous lecture, record:
- The matching topic name
- The previous lecture number and topic title

### 8.3 — Generate the Prerequisite Knowledge HTML

If matches were found, generate the `{{PREREQUISITE_KNOWLEDGE}}` HTML:

```html
<section class="prerequisite-section">
  <h2>Prerequisite Knowledge</h2>
  <p class="prerequisite-intro">This lecture builds on the following
  concepts from earlier lectures. If any feel unfamiliar, review the
  linked notes before proceeding.</p>

  <div class="prerequisite-entry">
    <h3>Previously Covered in This Subject</h3>
    <ul>
      <li><strong>Concept</strong> — covered in Lecture N</li>
    </ul>
  </div>
</section>
```

If no matches found, set `{{PREREQUISITE_KNOWLEDGE}}` to an empty string.

### 8.4 — Write back this lecture's topics to the YAML

From the completed HTML core, compile a flat list of every major topic covered using the section hierarchy:

- Every `h2` (section title) becomes a topic entry
- Every `h3` (subsection title) becomes a sub-topic entry

Format each topic (h2) using the standard format: `LectureNum.TopicNum Title` (e.g., if this is Lecture 3, a topic is formatted as `3.1 Title`). Format each subtopic (h3) using the standard format: `LectureNum.TopicNum.SubtopicNum Title` (e.g., a subtopic under that is formatted as `3.1.1 Title`). The first number must always match the current lecture number. Then run:

```bash
python scripts/update_topic_mapping.py "<Subject>" "<LectureNumber>" \
    "<Lecture Topic>" "<file_name>" <topics_file>
```

Where `<topics_file>` is a temporary text file containing one topic per line. If the subject's YAML file doesn't exist yet, the script creates it.

### 8.5 — Verify the update

Open the updated YAML file and confirm:
- The new lecture entry exists with correct lecture_number, topic, file_name
- The topics_covered list is complete
- No previous lectures were accidentally modified

---

## Step 9 — Run the lint gate

```bash
python scripts/lint.py output/<subject>/<lecture>/notes.html
```

Fix **every FAIL**. Re-run until clean. **Exception:** If readability (sentence length) is the only test failing at any point and you have already tried fixing it at least 2 times, mark the lint check as completed and move forward to the next task. WARNs don't block but usually flag real issues — fix them when possible.

The lint checks: template hygiene (no surviving `{{PLACEHOLDER}}`), viewport meta, metadata completeness, SEO (OG, Twitter, canonical, robots, keywords, JSON-LD, description length), callout box usage (all 5 types present), style separation (no `<style>`/inline `style`/Google Fonts), math delimiters (no `\\(`), PII/secrets, readability (sentence length), long tokens, exam revision entries, content structure.

---

## Step 10 — Self-score against the quality rubric

### Rubric (100 points)

| # | Category | Weight |
|---|----------|:------:|
| 1 | Completeness/coverage — every transcript concept present, every example fully worked | 14 |
| 2 | Teaching spine — all core spine steps per major concept (or procedural spine for algorithms), correct callout per step, situational steps where the transcript provides them | 12 |
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

- [ ] All sections converted individually with heading numbers verified against `_inventory.json`
- [ ] Section HTMLs assembled mechanically (no content changes during assembly)
- [ ] Intermediate `_sections/` directory and `_body.html` cleaned up
- [ ] Every concept present in teaching order; every transcript example worked in full
- [ ] All core spine steps per major concept (or procedural spine for algorithms); correct callout per step; situational steps where the transcript provides them
- [ ] Sampled paragraphs pass easy-language audit (avg <~20 words, terms defined on first use)
- [ ] Every tricky idea has concrete, mapping analogy
- [ ] Math: step-by-step, every symbol named, correct single-backslash delimiters, tensor shapes stated, every derivation complete with no skipped algebra
- [ ] No `*[verify]*` markers in visible body (resolved removed, escalated converted to warning callouts)
- [ ] Every worked example: all steps, real numbers, final highlighted, sense-check
- [ ] No thin summaries; domain knowledge supplemented
- [ ] Clean hierarchy; hook opener; bridges between concepts
- [ ] Anonymized: no PII; reads as standalone textbook
- [ ] Metadata JSON complete with examRevisionNotes
- [ ] Topic mapping: YAML updated for this lecture; prerequisite section populated (or omitted for new subjects)
- [ ] Professor intuition preserved (analogies, stories, confusion flags — not generic substitutes)
- [ ] Exam revision: one entry per major concept, built from core only, every formula renders
- [ ] SEO: description 100-155 chars, unique, keyword-rich; OG, Twitter, canonical, robots, keywords, JSON-LD all present
- [ ] Lint passes with zero FAILs (or only readability failing after 2 fix attempts)
- [ ] Score ≥ 85/100 and zero red-list items
