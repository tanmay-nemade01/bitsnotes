#!/usr/bin/env python3
r"""Shared utilities for reading topic_mapping YAML files.

Used by update_topic_mapping.py and imported by the lint gate to validate
topic_mapping updates. Uses PyYAML for reliable parsing.

Usage:
    from topic_mapping_utils import load_topic_map, find_previous_coverage
"""

import os
import re
import sys
import html

# Force UTF-8 encoding for standard output/error on Windows to prevent UnicodeEncodeError
if sys.platform.startswith("win"):
    import io
    if hasattr(sys.stdout, "encoding") and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "encoding") and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

TOPIC_MAPPINGS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "topic_mappings"))

# ---------------------------------------------------------------------------
# YAML loading
# ---------------------------------------------------------------------------

def _parse_yaml(text):
    """Parse a topic_mapping YAML string into a dict.

    Uses PyYAML (yaml.safe_load).

    Returns:
        dict with keys like subject_name, lectures (list of lecture dicts)
        or None if parse fails.
    """
    import yaml
    try:
        return yaml.safe_load(text)
    except Exception:
        return None


def load_topic_map(subject_name):
    """Load a topic_mapping YAML file by subject name.

    Tries direct filename match first (e.g. "Machine Learning" -> "Machine
    Learning.yaml"). If that fails, scans ALL YAML files in the directory
    and matches by the ``subject_name`` field inside each file. This handles
    acronym filenames (e.g. "ML.yaml" containing subject_name: "Machine
    Learning").

    Args:
        subject_name: e.g. "Artificial Computational Intelligence" or
                      "Artificial Computational Intelligence.yaml" or
                      "ACI" (acronym that matches a file like ACI.yaml)

    Returns:
        dict with keys: subject_name, lectures (list of lecture dicts)
        or None if no matching file found.
    """
    if subject_name.endswith(".yaml") or subject_name.endswith(".yml"):
        fname = subject_name
    else:
        fname = subject_name + ".yaml"

    # 1. Direct filename match
    path = os.path.join(TOPIC_MAPPINGS_DIR, fname)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        result = _parse_yaml(text)
        if result:
            return result

    # 2. Fallback: scan all YAMLs and match by subject_name field inside
    if not os.path.isdir(TOPIC_MAPPINGS_DIR):
        return None

    query = subject_name.replace(".yaml", "").replace(".yml", "").lower().strip()
    for candidate in os.listdir(TOPIC_MAPPINGS_DIR):
        if not (candidate.endswith(".yaml") or candidate.endswith(".yml")):
            continue
        cpath = os.path.join(TOPIC_MAPPINGS_DIR, candidate)
        with open(cpath, "r", encoding="utf-8") as f:
            text = f.read()
        parsed = _parse_yaml(text)
        if parsed and "subject_name" in parsed:
            if parsed["subject_name"].lower().strip() == query:
                return parsed
    return None


def get_all_topic_maps():
    """Load all topic_mapping YAML files in the topic_mappings directory.

    Returns:
        dict mapping subject_name -> topic_map dict
    """
    maps = {}
    if not os.path.isdir(TOPIC_MAPPINGS_DIR):
        return maps
    for fname in os.listdir(TOPIC_MAPPINGS_DIR):
        if fname.endswith(".yaml") or fname.endswith(".yml"):
            topic_map = load_topic_map(fname)
            if topic_map and "subject_name" in topic_map:
                maps[topic_map["subject_name"]] = topic_map
    return maps


# ---------------------------------------------------------------------------
# Matching and parsing helper functions
# ---------------------------------------------------------------------------

def _is_sublist(a, b):
    """Check if list a is a contiguous sub-sequence of list b."""
    if not a:
        return True
    if not b:
        return False
    len_a, len_b = len(a), len(b)
    for i in range(len_b - len_a + 1):
        if b[i:i+len_a] == a:
            return True
    return False


def _clean_and_normalize(text):
    """Unescape HTML, strip leading numbers, normalize case and non-alphanumerics."""
    if not text:
        return []
    text = html.unescape(str(text))
    # Remove leading numbering (e.g. "3.2.1 ", "1.1-", etc.)
    text = re.sub(r"^[\d\.\s\-]+", "", text)
    text = text.lower()
    # Replace non-alphanumeric characters with spaces
    text = re.sub(r"[^\w\s]", " ", text)
    return text.split()


def _topics_match(qt, ct, min_word_overlap=3):
    """Check if query topic qt matches covered topic ct."""
    qw = _clean_and_normalize(qt)
    cw = _clean_and_normalize(ct)

    if not qw or not cw:
        return False

    if qw == cw:
        return True

    STOP_WORDS = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
        "to", "was", "were", "will", "with", "or"
    }

    # 1. Contiguous sub-phrase match
    # If one of the phrases is a single word, it must not be a common stop word
    if len(qw) == 1:
        if qw[0] not in STOP_WORDS and _is_sublist(qw, cw):
            return True
    elif len(cw) == 1:
        if cw[0] not in STOP_WORDS and _is_sublist(cw, qw):
            return True
    else:
        if _is_sublist(qw, cw) or _is_sublist(cw, qw):
            return True

    # 2. Word overlap of non-stop words (with adaptive/custom threshold)
    qw_set = set(qw) - STOP_WORDS
    cw_set = set(cw) - STOP_WORDS
    overlap = len(qw_set & cw_set)

    if overlap > 0:
        effective_threshold = min(min_word_overlap, len(qw_set))
        if effective_threshold >= 2 and overlap >= effective_threshold:
            return True

    return False


def _safe_parse_lecture_number(num_str):
    """Safely extract the first sequence of digits as an integer."""
    num_str = str(num_str)
    match = re.search(r'\d+', num_str)
    if match:
        return int(match.group())
    return 0


def find_coverage_by_topics(topics, subject_name=None, exclude_lecture=None,
                            all_maps=None, min_word_overlap=3):
    """Find lectures that cover any of the given topics.

    Args:
        topics: list of topic name strings to search for
        subject_name: optional, restrict to one subject
        exclude_lecture: optional (subject, lecture_number) tuple to exclude
        all_maps: pre-loaded dict from get_all_topic_maps(), or None to load
        min_word_overlap: minimum word overlap for partial matching (default 3)

    Returns:
        list of dicts:
            {subject, lecture_number, topic, matching_topics: [matched sub-topics]}
    """
    if all_maps is None:
        all_maps = get_all_topic_maps()

    results = []
    for subj, tmap in all_maps.items():
        if subject_name and subj != subject_name:
            continue
        for lec in tmap.get("lectures", []):
            if exclude_lecture and \
               subj == exclude_lecture[0] and \
               str(lec.get("lecture_number", "")) == str(exclude_lecture[1]):
                continue
            covered = lec.get("topics_covered", [])
            if not isinstance(covered, list):
                continue

            matched = []
            for ct in covered:
                for qt in topics:
                    if _topics_match(qt, ct, min_word_overlap):
                        if ct not in matched:
                            matched.append(ct)
                        break

            if matched:
                results.append({
                    "subject": subj,
                    "lecture_number": lec.get("lecture_number"),
                    "lecture_topic": lec.get("topic"),
                    "file_name": lec.get("file_name", ""),
                    "matching_topics": matched[:5],
                })
    return results


def find_previous_coverage_in_subject(subject_name, current_lecture_number):
    """Find all lectures before the current one in the same subject.

    Args:
        subject_name: the subject to search
        current_lecture_number: current lecture number (int or string)

    Returns:
        list of lecture dicts (from YAML) for earlier lectures
    """
    topic_map = load_topic_map(subject_name)
    if not topic_map:
        return []
    current = _safe_parse_lecture_number(current_lecture_number)
    return [
        lec for lec in topic_map.get("lectures", [])
        if _safe_parse_lecture_number(lec.get("lecture_number", "0")) < current
    ]


def format_coverage_summary(results):
    """Format coverage results into a human-readable summary string.

    Args:
        results: list from find_coverage_by_topics()

    Returns:
        markdown string with coverage summary
    """
    if not results:
        return "No previous coverage found across existing topic maps."

    lines = ["### 📚 Previously Covered in Existing Lectures",
             "",
             "The following lectures already cover topics related to this transcript."]

    by_subject = {}
    for r in results:
        by_subject.setdefault(r["subject"], []).append(r)

    for subj, lecs in by_subject.items():
        lines.append(f"\n**{subj}**")
        for lec in lecs:
            lec_num = lec["lecture_number"]
            lec_topic = lec["lecture_topic"]
            lines.append(f"- Lecture {lec_num}: {lec_topic}")
            for mt in lec["matching_topics"]:
                lines.append(f"  - `{mt}`")

    return "\n".join(lines)


def format_previous_coverage_in_subject(subject_name, current_lecture_number):
    """Get and format coverage from previous lectures in the same subject.

    Args:
        subject_name: subject to check
        current_lecture_number: current lecture number

    Returns:
        markdown string listing previous lectures and their topics
    """
    prev = find_previous_coverage_in_subject(subject_name, current_lecture_number)
    if not prev:
        return "No previous lectures found for this subject."

    lines = [
        "### 📕 Previous Lectures in This Subject",
        "",
        f"The following {len(prev)} lecture(s) precede this one. Topics they cover",
        "that overlap with the current transcript should be treated as **review**",
        "rather than introduced as new material.",
        "",
    ]

    for lec in prev:
        lec_num = lec.get("lecture_number", "?")
        lec_topic = lec.get("topic", "Unknown")
        topics = lec.get("topics_covered", [])
        if not isinstance(topics, list):
            topics = []
        lines.append(f"**Lecture {lec_num}: {lec_topic}**")
        for t in topics:
            lines.append(f"- {t}")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    maps = get_all_topic_maps()
    print(f"Loaded {len(maps)} topic maps:")
    for name, m in maps.items():
        lec_count = len(m.get("lectures", []))
        print(f"  {name}: {lec_count} lectures")
        for lec in m.get("lectures", []):
            tc = lec.get("topics_covered", [])
            tc_count = len(tc) if isinstance(tc, list) else 0
            print(f"    L{lec.get('lecture_number')}: \"{lec.get('topic', '?')}\" ({tc_count} topics)")