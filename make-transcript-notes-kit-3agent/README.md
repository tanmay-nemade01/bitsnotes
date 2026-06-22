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

Does: exhaustive            Does: 9-step spine,          Does: HTML conversion,
      extraction,                  supplementation,             SEO metadata,
      PII stripping,               analogies,                   exam revision,
      professor intuition          worked examples,             lint gate,
      preservation                 pitfalls,                    rubric self-score
                                   domain connections

Output: dense draft         Output: enriched draft       Output: notes.html
        (markdown)                  (markdown + :::annotations) (lint-clean, ≥85)
```

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

2. "Use Agent 2 (enricher) to apply the 9-step spine to <dense-draft.md>."

3. "Use Agent 3 (formatter) to convert <enriched-draft.md> into notes.html.
    Run lint and self-score."
```

## What's inside

```
make-transcript-notes-kit-3agent/
├── SKILL_agent1_extractor.md   ← Agent 1: Extraction rules only
├── SKILL_agent2_enricher.md    ← Agent 2: Spine + supplementation rules
├── SKILL_agent3_formatter.md   ← Agent 3: HTML + SEO + lint + rubric
├── templates/
│   └── notes.html              ← HTML template
├── scripts/
│   └── lint.py                 ← Quality gate
└── references/
    └── prompts.md              ← Prompt cookbook
```

## Token comparison

| Approach | Files agent loads | Approx. tokens |
|---|---|---|
| Original toolkit (14 files) | SKILL.md + 8 guidelines + 4 other | ~12,000+ |
| Optimized (1 file) | SKILL.md | ~5,000 |
| **3-agent (this)** | **1 focused file per agent** | **~1,800 each** |
