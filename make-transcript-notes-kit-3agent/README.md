# make-transcript-notes-kit — 3-Agent Pipeline

Turn `.txt` lecture transcripts into self-contained textbook-quality HTML
using **three specialized agents** — each loads only its phase's rules,
dramatically reducing context-window bloat.

## How it works

Agent 1 (Extractor)          Agent 2 (Enricher)            Agent 3 (Formatter)
─────────────────          ──────────────────           ───────────────────
Reads: SKILL_agent1_       Reads: SKILL_agent2_        Reads: SKILL_agent3_
       extractor.md               enricher.md                 formatter.md

Input: raw .txt             Input: split dense draft     Input: split enriched draft
       transcript                  (markdown sections)          (markdown + annotations)

Does: HTML conversion,       Does: teaching spine        Does: section-by-section
      exhaustive,                  supplementation,             HTML conversion,
      extraction,                  analogies,                   SEO metadata,
      PII stripping,               worked examples,             exam revision,
      professor intuition          pitfalls,                    topic mapping (same-subject),
      preservation                 domain connections           prerequisite HTML section,
                                   (processed per-section)      YAML write-back,
                                                                lint gate,
                                                                rubric self-score

Output: dense draft         Output: enriched sections    Output: <Lecture>.html
        (markdown)          (markdown + :::annotations)   + updated topic_mappings/*.yaml
```

## Topic Mapping

The `topic_mappings/` directory (at the workspace root) contains YAML files
cataloguing every topic covered in every lecture. Topic mapping is handled
entirely by **Agent 3** — Agents 1 and 2 stay focused on extraction and
enrichment without any YAML interaction.

### What Agent 3 does with topic mapping
- Reads **only** the YAML file for the **same subject** as the transcript
  (handles acronym filenames like `ML.yaml` for "Machine Learning")
- If no YAML exists (new subject), skips prerequisite detection and just
  creates the YAML file during write-back
- Identifies which topics in this lecture overlap with previous lectures
  in the same subject
- Generates a **Prerequisite Knowledge** HTML section listing prior coverage
- Writes this lecture's topics back to the YAML file so future lectures
  can detect overlap
- Does NOT scan other subjects' YAML files

### Why Agent 3 (not a separate agent)
- Topic mapping is structured data lookup, not creative generation — it
  does not need a smart/expensive model
- Agents 1 and 2 give full treatment to every concept regardless of
  prior coverage — students get thorough explanations, and the
  prerequisite section is just a helpful cross-reference
- Keeps the pipeline at 3 agents with clean separation of concerns

### Benefits
- **Students see the full map** — every "this was covered in Lecture N"
  reference is explicit, making the curriculum navigable
- **Auto-growing knowledge base** — each new lecture enriches the topic
  map, so later lectures get better prerequisite detection
- **No distraction for Agents 1-2** — zero topic mapping overhead in the
  extraction and enrichment phases

## Output Structure

Each lecture is self-contained within its own folder structure under `outputs/<Subject>/<LecturePrefix>/` (e.g. `outputs/Machine Learning/ML_Lecture_6/`):

```
outputs/<Subject>/<LecturePrefix>/
├── <LecturePrefix>_notes_dense.md       ← Agent 1 output (exhaustive draft)
├── <LecturePrefix>_notes_enriched.md    ← Agent 2 output (enriched markdown)
├── sections/                            ← Workspace directory for split sections
└── <LecturePrefix>_notes/               ← Agent 3 output directory
    └── <LecturePrefix>_notes.html       ← Agent 3 final HTML output
```

All metadata, SEO tags (Open Graph, Twitter Cards, structured data), and lecture content are embedded directly in the single HTML file — **no companion `.json` files are created**. The BitsNotes viewer reads everything from the HTML itself via `<script id="lecture-metadata">`.

## Usage

Run the process in the following sequence:

```
0. "Set up folder structure and pre-create empty files with proper names under outputs/<Subject>/<LecturePrefix>/."
   Example for ML Lecture 6 (LecturePrefix: ML_Lecture_6):
   - Parent directory: outputs/Machine Learning/ML_Lecture_6/
   - Subdirectories: sections/ and ML_Lecture_6_notes/
   - Empty files: ML_Lecture_6_notes_dense.md, ML_Lecture_6_notes_enriched.md, and ML_Lecture_6_notes/ML_Lecture_6_notes.html

1. "Use Agent 1 (extractor) to process transcript.txt into <LecturePrefix>_notes_dense.md."

2. "Use Agent 2 (enricher) to split <LecturePrefix>_notes_dense.md, apply the teaching spine
    section-by-section, resolve all *[verify]* markers, and assemble into <LecturePrefix>_notes_enriched.md."

3. "Use Agent 3 (formatter) to split <LecturePrefix>_notes_enriched.md, convert the sections
    into HTML, assemble them, read topic_mappings/<Subject>.yaml for prerequisite
    detection, update the YAML, run lint, and self-score to produce <LecturePrefix>_notes/<LecturePrefix>_notes.html."
```

## What's inside

```
make-transcript-notes-kit-3agent/
├── SKILL_agent1_extractor.md  ← Agent 1: Exhaustive extraction
├── SKILL_agent2_enricher.md   ← Agent 2: Spine + supplementation (section-by-section)
├── SKILL_agent3_formatter.md  ← Agent 3: Section-by-section HTML + SEO + topic mapping + lint + rubric
├── templates/
│   └── notes.html             ← HTML template (with {{PREREQUISITE_KNOWLEDGE}})
├── scripts/
│   ├── lint.py                ← Quality gate
│   ├── _plain_language.py     ← Shared word lists for lint
│   ├── section_splitter.py    ← Splits enriched MD into per-section files + reassembles HTML
│   ├── topic_mapping_utils.py ← YAML parser + coverage search (acronym-aware)
│   └── update_topic_mapping.py ← YAML updater (called by Agent 3)
└── references/
    └── prompts.md             ← Prompt cookbook

Workspace root (shared):
├── topic_mappings/
│   ├── Artificial Computational Intelligence.yaml
│   ├── Data Management for Machine Learning.yaml
│   ├── Deep Reinforcement Learning.yaml
│   ├── Mathematical Foundations for Machine Learning.yaml
│   ├── Natural Language Processing.yaml
│   └── Software Engineering for Machine Learning.yaml
```

## Token comparison

| Approach | Files agent loads | Approx. tokens |
|---|---|---|
| Original toolkit (14 files) | SKILL.md + 8 guidelines + 4 other | ~12,000+ |
| Optimized (1 file) | SKILL.md | ~5,000 |
| **3-agent (this)** | **1 focused file per agent** | **~1,500 each (Agents 1-2), ~2,000 (Agent 3)** |

## Section-by-section processing (Agents 2 & 3)

Large markdown files cause attention degradation during LLM calls — leading to skipped concepts, math notation drift, and malformed tags.

To solve this, the pipeline splits the draft into sections **immediately after extraction**:

1. **Split** — `scripts/section_splitter.py split` breaks `dense-draft.md` into per-section files and locks heading numbering in `_inventory.json`.
2. **Enrich (Agent 2)** — Agent 2 enriches each section (`section_XX.md`) individually. It focuses all its attention on one concept at a time, ensuring maximum depth and quality without context bloat or output length issues.
3. **Convert (Agent 3)** — Agent 3 converts each enriched section to HTML. The heading numbers are locked and verified against `_inventory.json`.
4. **Assemble** — `scripts/section_splitter.py assemble` mechanically concatenates the section HTMLs into the final body. No content changes during assembly.

This contains errors to individual sections and makes quality checks extremely targeted.
