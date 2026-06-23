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
