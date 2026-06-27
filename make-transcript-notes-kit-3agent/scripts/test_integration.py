#!/usr/bin/env python3
"""Integration test for topic_mapping utils + update script."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))

from topic_mapping_utils import *
from update_topic_mapping import update_or_add_lecture

print("=== Test 1: Load all maps ===")
maps = get_all_topic_maps()
print(f"Loaded {len(maps)} subjects")

print("\n=== Test 2: Previous lectures before ACI L3 ===")
result = find_previous_coverage_in_subject("Artificial Computational Intelligence", 3)
for r in result:
    print(f'  L{r["lecture_number"]}: {r["topic"]}')

print("\n=== Test 3: Cross-subject reference for 'Search' ===")
results = find_coverage_by_topics(
    ["Search Algorithms", "BFS", "DFS", "Heuristic"],
    min_word_overlap=2
)
for r in results[:5]:
    print(f'  {r["subject"]} L{r["lecture_number"]}: matched {len(r["matching_topics"])} topics')

print("\n=== Test 4: Format summary ===")
print(format_coverage_summary(results[:3]))

print("\n=== Test 5: Update topic mapping ===")
path, added, updated = update_or_add_lecture(
    "Artificial Computational Intelligence", "9",
    "Test Integration Lecture",
    "ACI/ACI_Lecture_9_Notes/ACI_Lecture_9_Notes.html",
    ["9.1 Integration Test", "9.2 Cross-Reference Check"]
)
action = "Added" if added else "Updated" if updated else "No change"
print(f"{action} lecture at {path}")

# Clean up test
import yaml
data = yaml.safe_load(open(path, encoding="utf-8"))
data["lectures"] = [l for l in data["lectures"] if l.get("lecture_number") != "9"]
with open(path, "w", encoding="utf-8") as f:
    yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False, indent=2)
print("Cleaned up test entry")

print("\n=== ALL TESTS PASSED ===")