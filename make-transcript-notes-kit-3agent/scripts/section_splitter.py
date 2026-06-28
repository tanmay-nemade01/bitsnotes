#!/usr/bin/env python3
r"""Section splitter and assembler for Agent 3's section-by-section HTML conversion.

Splits an enriched markdown draft into per-section files so the LLM can convert
one section at a time, avoiding attention degradation on large documents.
After conversion, reassembles the per-section HTML fragments into a single body.

Usage:
    # Split the enriched markdown into per-section files
    python scripts/section_splitter.py split <enriched.md> --output-dir <dir>

    # Reassemble per-section HTML files into a single body
    python scripts/section_splitter.py assemble <section_dir> --output <body.html>

Split output:
    <output_dir>/
        _inventory.json    ← section map: [{num, title, file, subsections}]
        section_01.md      ← first ## section
        section_02.md      ← second ## section
        ...

The _inventory.json locks heading numbering before conversion starts.
The agent converts each section_XX.md → section_XX.html, then the
assemble command concatenates them in order.
"""

import argparse
import json
import os
import re
import sys

# Force UTF-8 on Windows
if sys.platform.startswith("win"):
    import io
    if hasattr(sys.stdout, "encoding") and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "encoding") and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
H2_PATTERN = re.compile(r"^##\s+(.+)$", re.MULTILINE)
H3_PATTERN = re.compile(r"^###\s+(.+)$", re.MULTILINE)

# ---------------------------------------------------------------------------
# Split
# ---------------------------------------------------------------------------

def split_markdown(md_path: str, output_dir: str) -> str:
    """Split a markdown file into per-h2-section files.

    Reads the markdown, finds all ``## `` headings, assigns section numbers,
    and writes each section to a separate file. Also writes ``_inventory.json``
    with the locked heading numbering.

    Content BEFORE the first ``## `` heading is treated as preamble and written
    to ``section_00_preamble.md``.

    Args:
        md_path: Path to the enriched markdown file.
        output_dir: Directory to write section files into.

    Returns:
        Path to the inventory JSON file.
    """
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()

    os.makedirs(output_dir, exist_ok=True)

    # Find all h2 headings with their positions
    h2_matches = list(H2_PATTERN.finditer(text))

    if not h2_matches:
        # No h2 headings — write entire file as a single section
        section_file = os.path.join(output_dir, "section_01.md")
        with open(section_file, "w", encoding="utf-8") as f:
            f.write(text)
        inventory = [{
            "num": 1,
            "title": "(Full Document)",
            "file": "section_01.md",
            "subsections": _extract_h3s(text)
        }]
        inv_path = os.path.join(output_dir, "_inventory.json")
        with open(inv_path, "w", encoding="utf-8") as f:
            json.dump(inventory, f, indent=2, ensure_ascii=False)
        return inv_path

    inventory = []

    # Preamble (content before first h2)
    first_h2_start = h2_matches[0].start()
    if first_h2_start > 0:
        preamble = text[:first_h2_start].strip()
        if preamble:
            preamble_file = os.path.join(output_dir, "section_00_preamble.md")
            with open(preamble_file, "w", encoding="utf-8") as f:
                f.write(preamble)
            inventory.append({
                "num": 0,
                "title": "(Preamble)",
                "file": "section_00_preamble.md",
                "subsections": []
            })

    # Extract each h2 section
    for i, match in enumerate(h2_matches):
        section_num = i + 1
        title = match.group(1).strip()
        start = match.start()
        end = h2_matches[i + 1].start() if i + 1 < len(h2_matches) else len(text)
        body = text[start:end].strip()

        # Extract h3 subsections within this section
        subsections = _extract_h3s(body)

        # Write section file
        section_file = f"section_{section_num:02d}.md"
        section_path = os.path.join(output_dir, section_file)
        with open(section_path, "w", encoding="utf-8") as f:
            f.write(body)

        inventory.append({
            "num": section_num,
            "title": title,
            "file": section_file,
            "subsections": subsections
        })

    # Write inventory
    inv_path = os.path.join(output_dir, "_inventory.json")
    with open(inv_path, "w", encoding="utf-8") as f:
        json.dump(inventory, f, indent=2, ensure_ascii=False)

    print(f"Split into {len(inventory)} section(s) in {output_dir}")
    print(f"Inventory: {inv_path}")
    return inv_path


def _extract_h3s(text: str) -> list[dict]:
    """Extract h3 headings from a section body, assigning subsection numbers."""
    h3s = []
    for j, m in enumerate(H3_PATTERN.finditer(text)):
        h3s.append({
            "sub_num": j + 1,
            "title": m.group(1).strip()
        })
    return h3s


# ---------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------

def assemble_html(section_dir: str, output_path: str) -> str:
    """Reassemble per-section HTML files into a single body HTML.

    Reads ``_inventory.json`` to get the section order, then concatenates
    all ``section_*.html`` files in order. Skips the preamble (section 0)
    unless it's the only section.

    Args:
        section_dir: Directory containing section HTML files and _inventory.json.
        output_path: Path to write the assembled body HTML.

    Returns:
        Path to the assembled output file.
    """
    inv_path = os.path.join(section_dir, "_inventory.json")
    if not os.path.exists(inv_path):
        print(f"ERROR: _inventory.json not found in {section_dir}", file=sys.stderr)
        sys.exit(1)

    with open(inv_path, "r", encoding="utf-8") as f:
        inventory = json.load(f)

    parts = []
    missing = []

    for entry in inventory:
        if entry["num"] == 0:
            # Preamble — include only if it has an html file
            preamble_html = os.path.join(section_dir, "section_00_preamble.html")
            if os.path.exists(preamble_html):
                with open(preamble_html, "r", encoding="utf-8") as f:
                    parts.append(f.read().strip())
            continue

        html_file = entry["file"].replace(".md", ".html")
        html_path = os.path.join(section_dir, html_file)
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f:
                parts.append(f.read().strip())
        else:
            missing.append(html_file)

    if missing:
        print(f"WARNING: {len(missing)} section HTML file(s) missing: {missing}", file=sys.stderr)

    body = "\n\n".join(parts)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(body)

    print(f"Assembled {len(parts)} section(s) → {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Split enriched markdown into per-section files, or reassemble HTML sections."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # split
    sp = sub.add_parser("split", help="Split markdown into per-section files")
    sp.add_argument("markdown", help="Path to enriched markdown file")
    sp.add_argument("--output-dir", required=True, help="Directory for section files")

    # assemble
    ap = sub.add_parser("assemble", help="Reassemble per-section HTML into a single body")
    ap.add_argument("section_dir", help="Directory containing section HTML files")
    ap.add_argument("--output", required=True, help="Path for assembled body HTML")

    args = parser.parse_args()

    if args.command == "split":
        split_markdown(args.markdown, args.output_dir)
    elif args.command == "assemble":
        assemble_html(args.section_dir, args.output)


if __name__ == "__main__":
    main()