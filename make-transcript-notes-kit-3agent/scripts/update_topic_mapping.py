#!/usr/bin/env python3
r"""Update a topic_mapping YAML file with a new lecture's details.

Called by Agent 3 (formatter) AFTER generating the HTML file but BEFORE the
lint gate runs. Appends or updates the lecture entry in the YAML file.

Usage:
    python scripts/update_topic_mapping.py <subject> <lecture_number> \
        <lecture_topic> <file_name> [topics_file]

    subject:       Full subject name (e.g. "Artificial Computational Intelligence")
    lecture_number: Lecture number (e.g. "3" or "1-2")
    lecture_topic:  Descriptive topic string (quote if it has spaces)
    file_name:      Relative path to the HTML file (e.g. "ACI/ACI_Lecture_3_Notes/ACI_Lecture_3_Notes.html")
    topics_file:    Optional path to a text file with one topic per line

If topics_file is omitted, the script enters interactive mode prompting for
topics_covered. When a topics_file is provided, the script reads them as the
complete list of topics_covered for this lecture.

The script:
  1. Reads the existing YAML file (or creates one if it doesn't exist).
  2. Checks if a lecture with the same lecture_number already exists.
     - If yes: updates it (keeping existing topics_covered, appending new ones).
     - If no: appends a new entry and writes the file.
  3. Writes the updated YAML back (preserving formatting as much as possible).

Exit code:
  0 = success
  1 = error (file not found, parse error, etc.)
"""

import os
import re
import sys
import json

# Add parent dirs to path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import topic_mapping_utils as TMU

TOPIC_MAPPINGS_DIR = TMU.TOPIC_MAPPINGS_DIR

# ---------------------------------------------------------------------------
# YAML writing
# ---------------------------------------------------------------------------

import yaml


def write_topic_map(subject_name, lectures):
    """Write the topic map YAML for a subject using PyYAML.

    Args:
        subject_name: the subject display name
        lectures: list of lecture dicts

    Returns:
        path to the written YAML file
    """
    if not os.path.exists(TOPIC_MAPPINGS_DIR):
        os.makedirs(TOPIC_MAPPINGS_DIR)

    fname = subject_name + ".yaml"
    path = os.path.join(TOPIC_MAPPINGS_DIR, fname)

    # Sort lectures numerically by lecture number
    def _get_lecture_sort_key(lec):
        num_str = str(lec.get("lecture_number", "0"))
        match = re.search(r'\d+', num_str)
        if match:
            return int(match.group())
        return 999999

    lectures_sorted = sorted(lectures, key=_get_lecture_sort_key)
    data = {"subject_name": subject_name, "lectures": lectures_sorted}

    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True,
                  sort_keys=False, indent=2, width=1000)

    return path


# ---------------------------------------------------------------------------
# Main update logic
# ---------------------------------------------------------------------------

def update_or_add_lecture(subject_name, lecture_number, lecture_topic,
                          file_name, new_topics):
    """Update or add a lecture to the topic map.

    Args:
        subject_name: full subject name
        lecture_number: lecture number (string)
        lecture_topic: descriptive topic string
        file_name: relative path to the HTML file
        new_topics: list of topic strings covered

    Returns:
        (path_to_yaml, was_added_bool, was_updated_bool)
    """
    import html
    subject_name = html.unescape(subject_name)
    lecture_topic = html.unescape(lecture_topic)
    file_name = html.unescape(file_name)
    new_topics = [html.unescape(t) for t in new_topics]

    # Try to load existing map
    topic_map = TMU.load_topic_map(subject_name)
    was_added = False
    was_updated = False

    if topic_map is None:
        # Create new topic map
        lectures = []
        was_added = True
    else:
        lectures = topic_map.get("lectures", [])

    # Find existing lecture by number
    existing_idx = None
    for i, lec in enumerate(lectures):
        if str(lec.get("lecture_number", "")) == str(lecture_number):
            existing_idx = i
            break

    if existing_idx is not None:
        # Update existing — merge topics (keep old, append new not already present)
        existing_lec = lectures[existing_idx]
        existing_topics = set(existing_lec.get("topics_covered", []))
        new_set = set(new_topics)
        merged = list(existing_topics | new_set)

        # Preserve original order: keep existing in place, append new at end
        ordered = list(existing_lec.get("topics_covered", []))
        seen = set(ordered)
        for t in new_topics:
            if t not in seen:
                ordered.append(t)
                seen.add(t)

        lectures[existing_idx] = {
            "lecture_number": str(lecture_number),
            "topic": lecture_topic,
            "file_name": file_name,
            "topics_covered": ordered,
        }
        was_updated = True
    else:
        # Add new lecture
        lectures.append({
            "lecture_number": str(lecture_number),
            "topic": lecture_topic,
            "file_name": file_name,
            "topics_covered": new_topics,
        })
        was_added = True

    path = write_topic_map(subject_name, lectures)
    return path, was_added, was_updated


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 5:
        print(__doc__)
        print("\nExample:")
        print("  python scripts/update_topic_mapping.py \\")
        print('      "Artificial Computational Intelligence" \\')
        print('      "3" \\')
        print('      "Search Algorithms and Problem-Solving Agents" \\')
        print('      "ACI/ACI_Lecture_3_Notes/ACI_Lecture_3_Notes.html" \\')
        print('      topics_list.txt')
        sys.exit(1)

    subject_name = sys.argv[1]
    lecture_number = sys.argv[2]
    lecture_topic = sys.argv[3]
    file_name = sys.argv[4]

    # Read topics from file or stdin
    if len(sys.argv) >= 6:
        topics_file = sys.argv[5]
        if not os.path.exists(topics_file):
            print(f"ERROR: topics file not found: {topics_file}", file=sys.stderr)
            sys.exit(1)
        with open(topics_file, "r", encoding="utf-8") as f:
            new_topics = [line.strip() for line in f if line.strip()]
    else:
        # Interactive mode
        print(f"Enter topics_covered for Lecture {lecture_number} of {subject_name}")
        print("(one per line, empty line to finish):")
        new_topics = []
        while True:
            try:
                line = input().strip()
                if not line:
                    break
                new_topics.append(line)
            except (EOFError, KeyboardInterrupt):
                break

    if not new_topics:
        print("WARNING: No topics provided. The YAML file will not be updated.",
              file=sys.stderr)
        # Still write with an empty topics list to record the lecture exists
        new_topics = []

    path, was_added, was_updated = update_or_add_lecture(
        subject_name, lecture_number, lecture_topic, file_name, new_topics)

    action = "Added" if was_added else "Updated" if was_updated else "No change"
    print(f"[OK] {action} lecture {lecture_number} in {path}")
    print(f"     Topics: {len(new_topics)} entries")


if __name__ == "__main__":
    main()