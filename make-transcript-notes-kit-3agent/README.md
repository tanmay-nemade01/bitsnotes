# make-transcript-notes-kit — 3-Agent Pipeline

Turn `.txt` lecture transcripts into self-contained textbook-quality HTML
using **three specialized agents** — each loads only its phase's rules,
dramatically reducing context-window bloat.

## How it works

```
Agent 1 (Extractor)          Agent 2 (Enricher)            Agent 3 (Formatter)
─────────────────          ──────────────────           ───────────────────
Reads: SKILL_agent1_       Reads: SKILL_agent2_        Reads: SKILL_agent3_
       extractor.md               enricher.md                 formatter.md

Input: raw .txt             Input: dense draft           Input: enriched draft
       transcript                  (markdown)                   (markdown + annotations)

Does: exhaustive            Does: teaching spine        Does: HTML conversion,
      extraction,                  supplementation,             SEO metadata,
      PII stripping,               analogies,                   exam revision,
      professor intuition          worked examples,             topic mapping (same-subject),
      preservation                 pitfalls,                    prerequisite HTML section,
                                   domain connections           YAML write-back,
                                                                lint gate,
                                                                rubric self-score

Output: dense draft         Output: enriched draft       Output: notes.html
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

## Output — single HTML file, no companion JSONs

Each lecture produces one file: `output/<Subject>/<Lecture>/notes.html`.

All metadata, SEO tags (Open Graph, Twitter Cards, structured data), and
lecture content are embedded directly in the HTML — **no companion `.json`
files are created**. The BitsNotes viewer reads everything from the HTML
itself via `<script id="lecture-metadata">`.

## Usage

Run each agent in sequence, feeding the output of one into the next:

```
1. "Use Agent 1 (extractor) to process <transcript.txt> into a dense draft."

2. "Use Agent 2 (enricher) to apply the teaching spine to <dense-draft.md>."

3. "Use Agent 3 (formatter) to convert <enriched-draft.md> into notes.html.
    Read topic_mappings/<Subject>.yaml for prerequisite detection.
    Update the YAML, run lint, and self-score."
```

## What's inside

```
make-transcript-notes-kit-3agent/
├── SKILL_agent1_extractor.md  ← Agent 1: Exhaustive extraction
├── SKILL_agent2_enricher.md   ← Agent 2: Spine + supplementation
├── SKILL_agent3_formatter.md  ← Agent 3: HTML + SEO + topic mapping + lint + rubric
├── templates/
│   └── notes.html             ← HTML template (with {{PREREQUISITE_KNOWLEDGE}})
├── scripts/
│   ├── lint.py                ← Quality gate
│   ├── _plain_language.py     ← Shared word lists for lint
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
