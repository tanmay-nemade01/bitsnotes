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

Does: exhaustive extraction,    Does: teaching spine        Does: section-by-section
      PII stripping,               supplementation,             HTML conversion,
      professor intuition          analogies,                   SEO metadata,
      preservation                 worked examples,             exam revision,
                                   pitfalls,                    topic mapping (same-subject),
                                   domain connections,          prerequisite HTML section,
                                   readability & style gate,    HTML/SEO lint gate,
                                   topic mapping YAML update    rubric self-score
                                   (processed per-section)

Output: dense draft         Output: enriched sections    Output: <LecturePrefix>_notes.html
        (markdown)          (markdown + :::annotations)
                            + updated topic_mappings/*.yaml
```

## Topic Mapping

The `topic_mappings/` directory (at the workspace root) contains YAML files cataloguing every topic covered in every lecture. Topic mapping is a collaborative effort between **Agent 2** (which writes topics to the YAML) and **Agent 3** (which reads topics to build prerequisite references).

### Topic Mapping Flow
1. **Agent 2 (Enricher)**:
   - Scans the completed enriched draft to compile all `##` and `###` heading titles.
   - Updates the subject's YAML file (`topic_mappings/<Subject>.yaml`) with this lecture's topics by running the `update_topic_mapping.py` script.
2. **Agent 3 (Formatter)**:
   - Reads the YAML file for the same subject to identify overlapping topics in previous lectures (lectures with a lower number).
   - Generates the **Prerequisite Knowledge** HTML section listing prior coverage.
   - Does NOT write back to the YAML (Agent 2 has already updated it).

### Benefits
- **Students see the full map** — every "this was covered in Lecture N" reference is explicit and complete.
- **No Agent 3 YAML write-back** — simplifies Phase 3 and avoids late-pipeline write-back errors.
- **Accurate mapping** — topics are extracted directly from the finalized enriched markdown.

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
1. "Use Agent 1 (extractor) to create the project directory outputs/<Subject>/<LecturePrefix>/ and process transcript.txt into <LecturePrefix>_notes_dense.md and <LecturePrefix>_extraction_manifest.json."

2. "Use Agent 2 (enricher) to split <LecturePrefix>_notes_dense.md (creating the sections/ directory), apply the teaching spine section-by-section, resolve all *[verify]* markers, optimize readability (sentence splitting, plain language), assemble into <LecturePrefix>_notes_enriched.md, and run lint_dense.py with --phase enriched."

3. "Use Agent 3 (formatter) to split <LecturePrefix>_notes_enriched.md, convert the sections into HTML, assemble them, read topic_mappings/<Subject>.yaml for prerequisite detection, run lint.py (style/readability warnings are downgraded), and self-score to produce the final html under a newly created <LecturePrefix>_notes/ folder."
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
│   └── update_topic_mapping.py ← YAML updater (called by Agent 2)
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
