#!/usr/bin/env python3
r"""Quality gate for dense markdown drafts (Agent 1's output).

Checks the dense draft notes_dense.md against the rules before Phase 2.
"""

import argparse
import io
import os
import re
import sys

# Force UTF-8 on Windows
if sys.platform.startswith("win"):
    if hasattr(sys.stdout, "encoding") and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "encoding") and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _plain_language as PL

# Patterns
H2_PATTERN = re.compile(r"^##\s+(.+)$", re.MULTILINE)
H3_PATTERN = re.compile(r"^###\s+(.+)$", re.MULTILINE)
DOTTED_H2 = re.compile(r"^(\d+)\.(\d+)\s+(.+)$")
DOTTED_H3 = re.compile(r"^(\d+)\.(\d+)\.(\d+)\s+(.+)$")

PII_PATTERNS = [
    ("transcript reference", re.compile(r"\b(transcript|lecture recording|audio recording|this recording)\b", re.I)),
    ("professor/instructor mention", re.compile(r"\b(professor|instructor|lecturer)\s+[A-Z][a-z]+\b")),
    ("university mention candidate", re.compile(r"\b(University|Institute|College)\s+of\s+[A-Z]")),
]

class Report:
    def __init__(self):
        self.rows = []
        self.counts = {"PASS": 0, "WARN": 0, "FAIL": 0}

    def add(self, level, name, message=""):
        self.rows.append((level, name, message))
        self.counts[level] += 1

    def passed(self, name, message=""):
        self.add("PASS", name, message)

    def warned(self, name, message=""):
        self.add("WARN", name, message)

    def failed(self, name, message=""):
        self.add("FAIL", name, message)

    def print_all(self):
        glyph = {"PASS": "[PASS]", "WARN": "[WARN]", "FAIL": "[FAIL]"}
        for level, name, message in self.rows:
            print(f"{glyph[level]} {name}")
            if message:
                for sub in message.splitlines():
                    print(f"         {sub}")

    @property
    def has_fail(self):
        return self.counts["FAIL"] > 0


def detect_lecture_num(path, text):
    # Try filename first
    filename = os.path.basename(path)
    match = re.search(r"[Ll]ecture[_-]?(\d+)", filename)
    if match:
        return int(match.group(1))
    
    # Try first H2 that starts with digits
    h2_matches = H2_PATTERN.findall(text)
    for title in h2_matches:
        title = title.strip()
        m = DOTTED_H2.match(title)
        if m:
            return int(m.group(1))
    return None


def check_numbering(text, lecture_num, report):
    h2_matches = []
    # Find h2s and their indices
    for match in H2_PATTERN.finditer(text):
        h2_matches.append((match.group(1).strip(), match.start(), match.end()))

    if not h2_matches:
        report.failed("numbering", "No H2 (##) headings found in document.")
        return

    expected_t = 1
    for title, start, end in h2_matches:
        if title in ("Exam Guidance Summary", "Key Industry Applications"):
            continue
        
        m = DOTTED_H2.match(title)
        if not m:
            report.failed("numbering", f"H2 heading '{title}' does not match dotted L.T pattern (e.g. '## 5.1 Concept').")
            continue
        
        l_val = int(m.group(1))
        t_val = int(m.group(2))
        
        if lecture_num is not None and l_val != lecture_num:
            report.failed("numbering", f"H2 heading '{title}' has lecture number {l_val}, expected {lecture_num}.")
        
        if t_val != expected_t:
            report.failed("numbering", f"H2 heading '{title}' has topic number {t_val}, expected {expected_t} (non-sequential).")
        
        expected_t += 1

    # Extract sections to check H3 numbering
    for i, (title, start, end) in enumerate(h2_matches):
        if title in ("Exam Guidance Summary", "Key Industry Applications"):
            continue
        
        m = DOTTED_H2.match(title)
        if not m:
            continue
        
        l_val = int(m.group(1))
        t_val = int(m.group(2))
        
        section_end = h2_matches[i+1][1] if i + 1 < len(h2_matches) else len(text)
        section_text = text[start:section_end]
        
        h3_matches = H3_PATTERN.findall(section_text)
        if not h3_matches:
            report.failed("numbering", f"Section '{title}' has no H3 subsections. Every section must have at least one subsection.")
            continue
            
        expected_s = 1
        for h3_title in h3_matches:
            h3_title = h3_title.strip()
            m3 = DOTTED_H3.match(h3_title)
            if not m3:
                report.failed("numbering", f"H3 heading '{h3_title}' does not match dotted L.T.S pattern.")
                continue
            
            l3 = int(m3.group(1))
            t3 = int(m3.group(2))
            s3 = int(m3.group(3))
            
            if l3 != l_val or t3 != t_val:
                report.failed("numbering", f"H3 heading '{h3_title}' has L.T values {l3}.{t3}, expected {l_val}.{t_val} under section '{title}'.")
            
            if s3 != expected_s:
                report.failed("numbering", f"H3 heading '{h3_title}' has sub-topic number {s3}, expected {expected_s} (non-sequential).")
                
            expected_s += 1

    if report.counts["FAIL"] == 0:
        report.passed("numbering", "Strict dotted numbering sequence and subsection structure is correct.")


def check_math_delimiters(text, report):
    # Flag double backslashes in body
    double_inline = re.findall(r"\\\\\(", text)
    double_block = re.findall(r"\\\\\[", text)
    
    if double_inline or double_block:
        report.failed("math delimiters", f"Found double-backslash math delimiters: {len(double_inline)} inline \\\\(, {len(double_block)} block \\\\[. MathJax will not render these.")
    
    # Flag single or double dollars
    dollars = len(re.findall(r"(?<!\\)\$\$?", text))
    if dollars > 0:
        report.failed("math delimiters", f"Found {dollars} raw $ or $$ delimiters. Use only single-backslash \\( ... \\) and \\[ ... \\].")
        
    if report.counts["FAIL"] == 0:
        report.passed("math delimiters", "Single-backslash math delimiters correctly formatted, no raw dollars/double backslashes found.")


def check_symbol_registries(text, report):
    h2_matches = []
    for match in H2_PATTERN.finditer(text):
        h2_matches.append((match.group(1).strip(), match.start()))

    for i, (title, start) in enumerate(h2_matches):
        if title in ("Exam Guidance Summary", "Key Industry Applications"):
            continue
        
        section_end = h2_matches[i+1][1] if i + 1 < len(h2_matches) else len(text)
        section_text = text[start:section_end]
        
        # Count math expressions using \( and \[
        math_blocks = len(re.findall(r"\\\(.*?\\\)|\\\[.*?\\\]", section_text, re.DOTALL))
        has_registry = "symbol registry" in section_text.lower()
        
        if math_blocks >= 3 and not has_registry:
            report.warned("symbol registry", f"Section '{title}' contains {math_blocks} math expression(s) but has no Symbol Registry. A registry is mandatory if 3+ new symbols are introduced.")


def check_pii_and_anonymization(text, report):
    pii_hits = []
    for label, pat in PII_PATTERNS:
        for m in pat.finditer(text):
            pii_hits.append(f"{label}: \"{m.group(0)}\"")
            
    if pii_hits:
        report.failed("PII / anonymization", f"PII or transcript references found (must read as a standalone textbook):\n  " + "\n  ".join(pii_hits))
    else:
        report.passed("PII / anonymization", "No PII or transcript references detected.")


def check_verify_markers(text, report, strict=False):
    # Verify markers should have a description/reason
    markers = re.findall(r"\*\[verify\b(.*?)\]\*", text)
    if strict and len(markers) > 0:
        report.failed("verify markers", f"Found {len(markers)} unresolved verify marker(s). In the enriched draft, all verify markers must be resolved or escalated.")
        return
        
    bad_markers = 0
    for m in markers:
        m = m.strip()
        if not m.startswith(":") or len(m) < 5:
            bad_markers += 1
            
    if bad_markers > 0:
        report.warned("verify markers", f"Found {bad_markers} verify marker(s) without a reason tag (e.g. use '*[verify: <reason>]*' instead of bare '*[verify]*').")
    elif len(markers) > 0:
        report.passed("verify markers", f"All {len(markers)} verify markers have description/reason tags.")
    else:
        report.passed("verify markers", "No verify markers found.")


def check_writing_style(text, report):
    # Filter out callout annotations (lines starting with :::)
    lines = [line for line in text.split("\n") if not line.strip().startswith(":::")]
    clean_text = "\n".join(lines)
    
    # Strip math expressions so they don't trigger readability check
    prose = re.sub(r"\\\(.*?\\\)|\\\[.*?\\\]|\$\$.*?\$\$", " ", clean_text, flags=re.DOTALL)
    
    # 1. Banned hand-waving
    hand_waves = PL.find_handwaving(prose)
    if hand_waves:
        detail = "; ".join(f"'{p}' ({c}x)" for p, c in hand_waves[:8])
        report.failed("hand-waving", f"Banned hand-waving words/phrases found: {detail}. Replace each with the algebra/logic it hides.")
    else:
        report.passed("hand-waving", "No banned hand-waving detected.")

    # 2. Reading Ease
    score, n_words, n_sent = PL.flesch_reading_ease(prose)
    if n_words > 50:
        if score < 45:
            report.warned("Flesch reading ease", f"Score is {score}/100 (<45 is hard, college-level). Aim for simpler prose.")
        else:
            report.passed("Flesch reading ease", f"Score is {score}/100.")

    # 3. Sentence lengths
    sentences = []
    _SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
    _WORD = re.compile(r"\S+")
    for line in prose.split("\n"):
        line = line.strip()
        if line and not line.startswith("#"):
            sentences.extend(s for s in _SENTENCE_SPLIT.split(line) if s.strip())
            
    long_sentences = 0
    for s in sentences:
        words_count = len(_WORD.findall(s))
        if words_count > PL.WORD_CEILING:
            long_sentences += 1
            
    total = len(sentences)
    ratio = long_sentences / total if total else 0
    if long_sentences > 0:
        msg = f"{long_sentences} sentences over {PL.WORD_CEILING} words ({ratio*100:.0f}% of {total} sentences)."
        if ratio > 0.15 or long_sentences >= 12:
            report.failed("sentence length", f"Too many long sentences. {msg} Split them to fit the smart-beginner audience.")
        else:
            report.warned("sentence length", f"Some long sentences found. {msg} Consider splitting.")
    else:
        report.passed("sentence length", "All sentences are short and clear.")


def check_fancy_words(text, report):
    # Filter out callout annotations (lines starting with :::)
    lines = [line for line in text.split("\n") if not line.strip().startswith(":::")]
    clean_text = "\n".join(lines)
    
    # Strip math expressions
    prose = re.sub(r"\\\(.*?\\\)|\\\[.*?\\\]|\$\$.*?\$\$", " ", clean_text, flags=re.DOTALL)
    
    hits = PL.find_fancy(prose)
    if not hits:
        report.passed("fancy words", "No fancy-word offenders detected.")
        return
    total = sum(c for _, _, c in hits)
    detail = "; ".join(f"'{w}'→'{s}' ({c}x)" for w, s, c in hits[:6])
    if total >= 10:
        report.failed("fancy words",
                      f"{total} fancy-word hit(s): {detail}. "
                      "Too many academic words — replace with plain alternatives.")
    else:
        report.warned("fancy words",
                      f"{total} fancy-word hit(s): {detail}. "
                      "Consider plain alternatives for a friendlier read.")


def lint_dense_file(path, lecture_num=None, phase="dense"):
    if not os.path.exists(path):
        print(f"Error: file not found at {path}", file=sys.stderr)
        sys.exit(2)
        
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    # Detect lecture num if none provided
    if lecture_num is None:
        lecture_num = detect_lecture_num(path, text)
        if lecture_num is not None:
            print(f"Detected Lecture Number: {lecture_num}")
        else:
            print("Warning: Could not detect lecture number. Skipping lecture-specific H2 check.")

    report = Report()
    
    check_numbering(text, lecture_num, report)
    check_math_delimiters(text, report)
    check_symbol_registries(text, report)
    check_pii_and_anonymization(text, report)
    
    strict_verify = (phase == "enriched")
    check_verify_markers(text, report, strict=strict_verify)
    
    check_writing_style(text, report)
    check_fancy_words(text, report)
    
    return report


def main():
    parser = argparse.ArgumentParser(description="Lint dense/enriched markdown drafts for quality.")
    parser.add_argument("markdown", help="Path to the markdown file.")
    parser.add_argument("--lecture-num", type=int, default=None, help="Explicit lecture number to enforce.")
    parser.add_argument("--phase", choices=["dense", "enriched"], default="dense", help="Pipeline phase (dense or enriched).")
    args = parser.parse_args()
    
    print("=" * 68)
    print(f"Linting {args.phase.capitalize()} Draft: {args.markdown}")
    print("=" * 68)
    
    report = lint_dense_file(args.markdown, args.lecture_num, args.phase)
    report.print_all()
    
    print("-" * 68)
    c = report.counts
    print(f"Summary: {c['PASS']} PASS, {c['WARN']} WARN, {c['FAIL']} FAIL")
    if report.has_fail:
        print("Result: FAIL (one or more checks failed). Fix all FAIL items and re-run.")
        sys.exit(1)
    if c["WARN"]:
        print("Result: PASS WITH WARNINGS. Review warnings; no blocking issues.")
        sys.exit(0)
    print(f"Result: PASS. Ready for the next phase.")
    sys.exit(0)


if __name__ == "__main__":
    main()
