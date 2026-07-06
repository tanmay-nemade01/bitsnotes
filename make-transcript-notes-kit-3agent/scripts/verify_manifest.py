#!/usr/bin/env python3
r"""Verification script for the 3-Agent Toolkit.

Checks if all elements documented in the Agent 1 extraction manifest are present
in the enriched markdown draft notes_enriched.md.
"""

import argparse
import io
import json
import os
import re
import sys

# Force UTF-8 on Windows
if sys.platform.startswith("win"):
    if hasattr(sys.stdout, "encoding") and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "encoding") and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Heading patterns
H2_PATTERN = re.compile(r"^##\s+(.+)$", re.MULTILINE)
DOTTED_H2 = re.compile(r"^(\d+)\.(\d+)\s+(.+)$")

class VerifyReport:
    def __init__(self):
        self.failures = []
        self.passes = []
        self.warnings = []

    def fail(self, name, message):
        self.failures.append((name, message))

    def warn(self, name, message):
        self.warnings.append((name, message))

    def passed(self, name, message):
        self.passes.append((name, message))

    def print_summary(self):
        print(f"=== Verification Passes: {len(self.passes)} ===")
        for name, msg in self.passes[:15]:
            print(f"[PASS] {name}: {msg}")
        if len(self.passes) > 15:
            print(f"... and {len(self.passes) - 15} more passes.")

        if self.warnings:
            print(f"\n=== Verification Warnings: {len(self.warnings)} ===")
            for name, msg in self.warnings:
                print(f"[WARN] {name}: {msg}")

        if self.failures:
            print(f"\n=== Verification Failures: {len(self.failures)} ===")
            for name, msg in self.failures:
                print(f"[FAIL] {name}: {msg}")
        else:
            print("\nResult: ALL MANIFEST VERIFICATIONS PASSED")


def extract_keywords(text, min_len=4):
    """Tokenize text into lowercase words of length >= min_len, filtering out markdown markup."""
    # Strip markdown symbols
    cleaned = re.sub(r"[\#\*_`\[\]\(\):-]", " ", text)
    words = re.findall(r"\b[a-zA-Z]{" + str(min_len) + r",}\b", cleaned)
    # Filter out common stop words
    stops = {
        "with", "that", "this", "from", "have", "they", "more", "about",
        "some", "were", "what", "their", "them", "then", "there", "when"
    }
    return {w.lower() for w in words if w.lower() not in stops}


def keyword_match(pattern_text, target_text, threshold=2):
    """Check if at least 'threshold' keywords from pattern_text are present in target_text."""
    pat_keywords = extract_keywords(pattern_text)
    if not pat_keywords:
        # Fallback to simple containment if no long keywords found
        return pattern_text.lower() in target_text.lower()
    
    target_lower = target_text.lower()
    matched = [kw for kw in pat_keywords if kw in target_lower]
    
    req_match = min(threshold, len(pat_keywords))
    return len(matched) >= req_match


def verify_manifest(manifest_path, markdown_path):
    report = VerifyReport()
    
    if not os.path.exists(manifest_path):
        report.fail("Manifest file", f"Manifest file does not exist: {manifest_path}")
        return report
    
    if not os.path.exists(markdown_path):
        report.fail("Markdown file", f"Markdown file does not exist: {markdown_path}")
        return report

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        report.fail("Manifest file", f"Failed to parse manifest JSON: {e}")
        return report

    with open(markdown_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    # Split markdown into sections
    h2_matches = list(H2_PATTERN.finditer(md_text))
    sections = {}
    
    for i, match in enumerate(h2_matches):
        title = match.group(1).strip()
        start = match.start()
        end = h2_matches[i+1].start() if i + 1 < len(h2_matches) else len(md_text)
        sect_text = md_text[start:end]
        
        # Try to parse dotted ID
        m = DOTTED_H2.match(title)
        if m:
            dotted_id = f"{m.group(1)}.{m.group(2)}"
            sections[dotted_id] = {
                "title": title,
                "text": sect_text,
                "clean_title": m.group(3).strip()
            }
        else:
            # Fallback using title itself for special sections
            sections[title] = {
                "title": title,
                "text": sect_text,
                "clean_title": title
            }

    # Verify Concepts
    manifest_concepts = manifest.get("concepts", [])
    for concept in manifest_concepts:
        cid = concept.get("id")
        title = concept.get("title", "")
        
        if cid not in sections:
            # Try to match by title
            matched_sect = None
            for sect_id, sect_info in sections.items():
                if title.lower() in sect_info["title"].lower():
                    matched_sect = sect_id
                    break
            if matched_sect:
                cid = matched_sect
            else:
                report.fail(f"Concept {cid}", f"Concept '{title}' (ID {cid}) is missing from enriched markdown.")
                continue
                
        sect = sections[cid]
        sect_text = sect["text"]
        report.passed(f"Concept {cid}", f"Section found: '{sect['title']}'")
        
        # Verify Formula Requirement
        if concept.get("has_formula"):
            has_math = "\\" in sect_text and ("(" in sect_text or "[" in sect_text)
            if not has_math:
                report.fail(f"Concept {cid} Formula", f"Concept '{title}' is marked as having a formula, but no math block \\( or \\[ was found.")
            else:
                report.passed(f"Concept {cid} Formula", "Math blocks found.")
                
        # Verify Worked Example Requirement
        if concept.get("has_worked_example"):
            has_example = ":::example-box" in sect_text
            if not has_example:
                report.fail(f"Concept {cid} Example", f"Concept '{title}' is marked as having a worked example, but no :::example-box was found.")
            else:
                report.passed(f"Concept {cid} Example", "Example box found.")
                
        # Verify Q&A Requirement
        if concept.get("has_qna"):
            has_qna = ":::important-note" in sect_text and ("**Q:**" in sect_text or "**A:**" in sect_text or "Q:" in sect_text)
            if not has_qna:
                report.fail(f"Concept {cid} Q&A", f"Concept '{title}' is marked as having Q&A, but no Q&A exchange (:::important-note with **Q:**) was found.")
            else:
                report.passed(f"Concept {cid} Q&A", "Q&A exchange found.")

    # Verify Worked Examples by keywords
    for example in manifest.get("worked_examples", []):
        cid = example.get("concept")
        desc = example.get("description", "")
        
        if cid in sections:
            sect_text = sections[cid]["text"]
            if not keyword_match(desc, sect_text, threshold=2):
                report.warn(f"Worked Example ({cid})", f"Worked example '{desc}' keywords not matched in section text. Check if this example was skipped or renamed.")
            else:
                report.passed(f"Worked Example ({cid})", f"Example matches description: '{desc}'")

    # Verify Formulas by keywords
    for formula in manifest.get("formulas", []):
        cid = formula.get("concept")
        desc = formula.get("description", "")
        
        if cid in sections:
            sect_text = sections[cid]["text"]
            if not keyword_match(desc, sect_text, threshold=2):
                report.warn(f"Formula ({cid})", f"Formula description '{desc}' keywords not matched in section text.")
            else:
                report.passed(f"Formula ({cid})", f"Formula description matched: '{desc}'")

    # Verify Q&As by keywords
    for qna in manifest.get("qna_exchanges", []):
        cid = qna.get("concept")
        q_summary = qna.get("question_summary", "")
        
        if cid in sections:
            sect_text = sections[cid]["text"]
            if not keyword_match(q_summary, sect_text, threshold=2):
                report.warn(f"Q&A ({cid})", f"Q&A question summary '{q_summary}' keywords not matched in section text.")
            else:
                report.passed(f"Q&A ({cid})", f"Q&A matches summary: '{q_summary}'")

    # Verify Exam Guidance by keywords
    for exam in manifest.get("exam_guidance", []):
        cid = exam.get("concept")
        guidance = exam.get("guidance", "")
        
        if cid in sections:
            sect_text = sections[cid]["text"]
            if not keyword_match(guidance, sect_text, threshold=2):
                # Check global Exam Guidance Summary as well
                exam_summary_sect = sections.get("Exam Guidance Summary")
                found_in_summary = exam_summary_sect and keyword_match(guidance, exam_summary_sect["text"], threshold=2)
                
                if not found_in_summary:
                    report.warn(f"Exam Guidance ({cid})", f"Exam guidance '{guidance}' not matched in section or Exam Guidance Summary.")
                else:
                    report.passed(f"Exam Guidance ({cid})", f"Exam guidance found in Exam Guidance Summary: '{guidance}'")
            else:
                report.passed(f"Exam Guidance ({cid})", f"Exam guidance matched in section: '{guidance}'")

    # Verify Named References
    for ref in manifest.get("named_references", []):
        name = ref.get("name", "")
        if name:
            if name.lower() not in md_text.lower():
                report.warn(f"Reference", f"Named reference '{name}' is not found in the enriched text.")
            else:
                report.passed(f"Reference", f"Named reference '{name}' found.")

    return report


def main():
    parser = argparse.ArgumentParser(description="Verify enriched markdown against the extraction manifest.")
    parser.add_argument("manifest", help="Path to _extraction_manifest.json")
    parser.add_argument("markdown", help="Path to enriched markdown file (e.g. notes_enriched.md)")
    args = parser.parse_args()
    
    print("=" * 68)
    print(f"Verifying Enriched Content against Manifest")
    print(f"Manifest: {args.manifest}")
    print(f"Markdown: {args.markdown}")
    print("=" * 68)
    
    report = verify_manifest(args.manifest, args.markdown)
    report.print_summary()
    
    if report.failures:
        print("-" * 68)
        print(f"Result: FAIL ({len(report.failures)} core checklist failure(s) found). Verify and correct enriched content.")
        sys.exit(1)
        
    sys.exit(0)


if __name__ == "__main__":
    main()
