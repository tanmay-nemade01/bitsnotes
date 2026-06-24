# Prompt cookbook — copy, paste, go

## Full conversion
```text
Use make-transcript-notes-kit to convert the lecture transcript for
<Lecture Name> in <Subject>. Go through all three phases: exhaustive
extraction, domain knowledge supplementation with the full 9-step teaching
spine, and HTML formatting. Generate the metadata JSON, exam revision notes,
and every callout box. Run the lint gate at the end.
```

## Quick notes (extraction + formatting only)
```text
Use make-transcript-notes-kit to convert the <Lecture Name> transcript.
Focus on Phase 1 (exhaustive extraction) and Phase 3 (HTML formatting).
Skip heavy domain knowledge supplementation.
```

## Enrich existing notes (Phase 2 pass)
```text
Take the existing notes in <path/to/notes.html> and run Phase 2 against
them — supplement every concept with domain knowledge, analogies, worked
examples, pitfalls, and domain connections. Complete the 9-step spine for
every major concept. Self-score against the quality rubric when done.
```

## One concept deep-dive
```text
In the notes for <Lecture Name>, apply the full 9-step teaching spine to
the section on <specific concept>. Add hook, intuition+analogy, step-by-step
math with every symbol named, fully worked example with real numbers,
pitfall warning box, domain connection, and recap.
```

## Easy-language pass
```text
Run an easy-language pass on the notes at <path>. Split sentences >~25 words,
define every term on first use inline, replace jargon with plain words, and
ensure every formula has a plain-English intuition before it.
```

## Add more worked examples
```text
In the notes for <Lecture Name>, add 2-3 fully-worked examples for
<concept X> — different numbers each time, every step shown, in .example-box
callouts. Each must end with a one-sentence sense-check.
```

## Exam-prep edition
```text
Regenerate the exam revision notes from the core content of <Lecture Name>.
One .exam-revision-entry per major concept with must-know, key formula,
#1 pitfall, self-check, and connections. Built from the core — never invent.
```

## Fix lint failures
```text
lint.py reported FAILs on <path>. Fix every FAIL and re-run until it passes.
```

## Re-score against rubric
```text
Self-score the notes at <path> against the quality rubric. Give breakdown
per category and list every gap keeping it under 85.
```

## Math-focused extraction (Phase 1, math-heavy lecture)
```text
Use Agent 1 (extractor) to process <transcript.txt> into a dense draft.
This lecture is math-heavy and the transcript describes formulas and
derivations in plain language. Follow the Math extraction protocol strictly:
reconstruct real LaTeX for every formula, keep the professor's verbal
description next to each equation as the audit trail, build a symbol registry
per concept (name, meaning, type, units/domain, LaTeX), capture every
derivation step and mark skipped steps with *[verify]*, dimension/shape-check
every vector/matrix formula, and tag any uncertain reconstruction with
*[verify: <reason>]* instead of silently guessing. Output the math map as
part of the Step 0.5 inventory.
```

## Math reconciliation (Phase 2, with enrichment docs)
```text
Use Agent 2 (enricher) to apply the 9-step spine to <dense-draft.md> using
the attached enrichment docs <doc1.pdf, doc2.md, ...> as MATH GROUND TRUTH
for the topics the transcript already covers. Resolve every *[verify]*
marker from Agent 1: confirm, correct, or fill each one against the docs
without introducing new topics. Complete every derivation end-to-end with
annotated algebra steps. Keep the professor's notation as primary; note
standard alternatives, never silently replace. Run the Step R4 factuality
checks (dimensions, limiting case, domain, numerical spot-check) on every
reconciled formula. Any marker the docs do not cover must be escalated with
a :::warning-box callout, not left bare. Report a final marker sweep.
```

## Verify just the formulas in existing notes
```text
Scan <path/to/notes.html> for every formula. For each, run the Step R4
factuality checks from the enricher skill: dimensional/shape consistency,
limiting/special-case reduction, output domain, and a tiny numerical
spot-check. List any formula that fails a check, with the failing check
and a proposed correction. Do not edit the file — just report.
```

## Complete a skipped derivation
```text
In the notes for <Lecture Name>, the section on <concept> shows a
derivation that skips from <line A> to <line B> with "after simplification".
Fill in every missing algebraic step in a \begin{aligned} block, each line
annotated with the move (distribute, substitute, apply Bayes, take log,
etc.). Source each non-trivial step from <enrichment doc> or a standard
identity. Remove any *[verify]* marker once the gap is filled.
```

## Symbol-registry pass
```text
For each section in <path> that introduces three or more new symbols, add a
Symbol Registry block listing: symbol, plain-language meaning, LaTeX, type
(scalar/vector/matrix), and units or domain. Ensure every symbol used in
that section's math appears in the registry.
```
