#!/usr/bin/env python3
"""Shared plain-English word lists + readability helpers for lint.py.

Imported by `lint.py` so the language rules are defined once and enforced
consistently. Mirrors the same approach used in make-lecture-kit.

Pure standard library. No third-party deps, no network.
"""

import re

# Sentence-length policy for ordinary prose after math/code/table stripping.
# These are review hints, never blocking targets.
WORD_AIM = 20
WORD_CEILING = 28

# --------------------------------------------------------------------------- #
# 1. Hand-waving — BANNED OUTRIGHT (hard FAIL).
# --------------------------------------------------------------------------- #
HANDWAVE_PHRASES = [
    "it can be shown",
    "it can be proven",
    "it is easy to see",
    "it is clear that",
    "it should be apparent",
    "it should be obvious",
    "left to the reader",
    "left as an exercise",
    "the details are omitted",
    "after some algebra",
    "after simplification",
    "as is well known",
    "needless to say",
    "it goes without saying",
    "suffice it to say",
]
HANDWAVE_WORDS = [
    "clearly", "obviously", "evidently", "trivially", "plainly",
]

# --------------------------------------------------------------------------- #
# 2. Literary / filler flourishes — flagged (WARN; many => FAIL).
# --------------------------------------------------------------------------- #
FLOURISH_PHRASES = [
    "dissolve into", "dissolved into", "dissolves into",
    "the machinery of",
    "earns its keep", "earn its keep",
    "the chase for",
    "a tapestry of", "the dance of", "the symphony of",
    "lies at the intersection of", "at the intersection of",
    "in the realm of", "in the world of",
    "it is important to note that", "it is worth noting that",
    "it's important to note that", "it's worth noting that",
    "it is crucial to understand that", "it is crucial to note that",
    "as we can see",
    "in essence", "essentially,", "fundamentally,",
]

# --------------------------------------------------------------------------- #
# 3. Fancy words -> optional plain swaps (advisory WARN only).
# --------------------------------------------------------------------------- #
FANCY_WORDS = {
    "utilize": "use", "utilise": "use", "utilizes": "uses", "utilises": "uses",
    "utilizing": "using", "utilising": "using", "utilization": "use",
    "utilisation": "use",
    "leverage": "use", "leverages": "uses", "leveraging": "using",
    "facilitate": "help", "facilitates": "help", "facilitating": "helping",
    "demonstrate": "show", "demonstrates": "shows", "demonstrated": "showed",
    "obtain": "get", "obtains": "gets", "obtained": "got",
    "sufficient": "enough", "insufficient": "not enough",
    "numerous": "many", "myriad": "many", "plethora": "a lot",
    "additional": "more", "approximately": "about",
    "subsequently": "then", "commence": "start", "commences": "starts",
    "terminate": "end", "terminates": "ends",
    "furthermore": "also", "moreover": "also",
    "thus": "so", "hence": "so", "therefore": "so", "consequently": "so",
    "whence": "so",
    "nevertheless": "but", "nonetheless": "still",
    "regarding": "about", "pertaining": "about",
    "aforementioned": "this", "possess": "have", "possesses": "has",
    "comprise": "include", "comprises": "includes", "encompass": "include",
    "encompasses": "includes", "elucidate": "explain", "expound": "explain",
    "ascertain": "find out", "endeavour": "try", "endeavor": "try",
    "crucial": "key", "pivotal": "key", "paramount": "key",
    "robust": "strong", "ubiquitous": "everywhere", "salient": "main",
    "methodology": "method", "dichotomy": "split",
    "cognizant": "aware", "delineate": "describe",
}

# --------------------------------------------------------------------------- #
# 4. Clichés, Jargon, and AI/Marketing Hype — WARN only, never FAIL.
#
# This list targets phrases that are *unambiguously* AI-chatbot or corporate
# jargon. Words with legitimate technical meanings (transform, harness, may,
# could, etc.) are intentionally excluded — the agent prompt teaches judgment,
# and the lint gate only softly warns on these patterns.
# --------------------------------------------------------------------------- #
CLICHES_AND_JARGON = {
    # AI-chatbot clichés (almost never appropriate in educational notes)
    "dive into": "look at / explain",
    "dives into": "explains / covers",
    "diving into": "looking at / covering",
    "delve into": "look at / explain",
    "delves into": "explains / covers",
    "delving into": "looking at / covering",
    "unleash": "use / enable",
    "unleashes": "enables",
    "unleashing": "enabling",
    "unleash your potential": "improve your skills",
    "unleash the potential": "use / enable",
    "game-changing": "effective / important",
    "game changer": "useful improvement",
    "transformative": "helpful / significant",
    "explore the depth of": "understand",
    "explore the depths of": "understand",
    "groundbreaking": "new / significant",
    "cutting-edge": "modern / recent",
    # Corporate jargon (never appropriate in educational notes)
    "touch base": "meet / discuss",
    "touches base": "meets / discusses",
    "touching base": "meeting / discussing",
    "move the needle": "improve results",
    "moves the needle": "improves results",
    "moving the needle": "improving results",
    "mission-critical": "important / essential",
    "mission critical": "important / essential",
    "deliverable": "result / output",
    "deliverables": "results / outputs",
    "synergy": "cooperation / combination",
    "synergies": "combinations",
    "synergistic": "combined",
    "paradigm shift": "major change",
    "paradigm shifts": "major changes",
}

# --------------------------------------------------------------------------- #
# 5. PII / anonymisation — shared by the dense and HTML lint gates.
#
# Severity policy (single source of truth):
#   FAIL — direct transcript/recording references (notes must stand alone)
#   WARN — professor/university mention candidates (may be academic citations)
# --------------------------------------------------------------------------- #
PII_PATTERNS = [
    ("transcript reference", re.compile(
        r"\b(?:transcript|lecture\s+recording|audio\s+recording|this\s+recording)\b",
        re.IGNORECASE)),
    # Match the role word case-insensitively but keep the proper noun's case
    # requirement, so "professor Bishop" is caught without flagging
    # "professor of physics".
    ("professor/instructor mention", re.compile(
        r"\b(?:[Pp]rofessor|[Ii]nstructor|[Ll]ecturer)\s+[A-Z][a-z]+\b")),
    ("university mention candidate", re.compile(
        r"\b(?:[Uu]niversity|[Ii]nstitute|[Cc]ollege)\s+of\s+[A-Z]")),
]

_PII_FAIL_LABELS = {
    "transcript reference",
    "professor/instructor mention",
}


def find_pii(text):
    """Return [(label, matched_text)] for every PII candidate."""
    hits = []
    for label, pattern in PII_PATTERNS:
        for match in pattern.finditer(text):
            hits.append((label, match.group(0)))
    return hits


def pii_severity(label):
    """Return "FAIL" or "WARN" for a PII label using the shared policy."""
    return "FAIL" if label in _PII_FAIL_LABELS else "WARN"


# --------------------------------------------------------------------------- #
# 6. Shared pre-processing helpers
# --------------------------------------------------------------------------- #
VERIFY_MARKER_RE = re.compile(r"\*\[verify\b[^\]]*\]\*", re.IGNORECASE)


def strip_verify_markers(text):
    """Remove *[verify: ...]* markers before prose heuristics run.

    A marker's reason can legitimately contain a phrase like "after
    simplification"; that is metadata about the reconstruction, not
    hand-waving prose.
    """
    return VERIFY_MARKER_RE.sub(" ", text)


# Pre-compiled matchers ------------------------------------------------------ #
_FANCY_RE = {
    w: re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE)
    for w in FANCY_WORDS
}
_HANDWORD_RE = {
    w: re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE)
    for w in HANDWAVE_WORDS
}
_CLICHES_RE = {
    w: re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE)
    for w in CLICHES_AND_JARGON
}
_VOWEL_GROUP = re.compile(r"[aeiouy]+")
_WORD = re.compile(r"[A-Za-z']+")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def find_handwaving(text):
    """Return [(phrase, count)] for every banned hand-wave found (hard FAIL)."""
    low = text.lower()
    hits = []
    for p in HANDWAVE_PHRASES:
        c = low.count(p)
        if c:
            hits.append((p, c))
    for w, rx in _HANDWORD_RE.items():
        c = len(rx.findall(text))
        if c:
            hits.append((w, c))
    return hits


def find_flourishes(text):
    """Return [(phrase, count)] for literary/filler flourishes (WARN)."""
    low = text.lower()
    return [(p, low.count(p)) for p in FLOURISH_PHRASES if low.count(p)]


def find_fancy(text):
    """Return [(word, suggestion, count)] for fancy words (WARN)."""
    out = []
    for w, rx in _FANCY_RE.items():
        c = len(rx.findall(text))
        if c:
            out.append((w, FANCY_WORDS[w], c))
    out.sort(key=lambda t: (-t[2], t[0]))
    return out


def find_cliches_and_jargon(text):
    """Return [(word, suggestion, count)] for clichés, jargon, AI/marketing words (WARN)."""
    out = []
    for w, rx in _CLICHES_RE.items():
        c = len(rx.findall(text))
        if c:
            out.append((w, CLICHES_AND_JARGON[w], c))
    out.sort(key=lambda t: (-t[2], t[0]))
    return out


def count_syllables(word):
    """Cheap, robust syllable estimate (good enough for a readability score)."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    groups = _VOWEL_GROUP.findall(w)
    n = len(groups)
    if w.endswith("e") and n > 1:
        n -= 1
    return max(1, n)


def flesch_reading_ease(text):
    """Return (score, n_words, n_sentences). Higher = easier.

    Flesch Reading Ease = 206.835 - 1.015*(words/sentences) - 84.6*(syll/words).
    ~90+ very easy, 60-70 plain English (≈ grade 8-9), <50 fairly hard,
    <30 very hard.
    """
    sentences = [s for s in _SENT_SPLIT.split(text) if s.strip()]
    words = _WORD.findall(text)
    n_sent = max(1, len(sentences))
    n_words = len(words)
    if n_words == 0:
        return (100.0, 0, n_sent)
    syll = sum(count_syllables(w) for w in words)
    score = (206.835
             - 1.015 * (n_words / n_sent)
             - 84.6 * (syll / n_words))
    return (round(score, 1), n_words, n_sent)


# --------------------------------------------------------------------------- #
# 7. Non-academic / Rhetorical Q&A patterns & Pseudo-symbol detectors
# --------------------------------------------------------------------------- #
BOGUS_QA_PATTERNS = [
    ("empty rhetorical check-in", re.compile(
        r"\b(?:no\s+blocking\s+doubt|no\s+doubt\s+came\s+up|discussion\s+moved\s+on|are\s+there\s+any\s+questions\b.*?\bbefore\s+moving\s+on)\b",
        re.IGNORECASE
    )),
    ("course/platform logistics in Q&A", re.compile(
        r"\b(?:available\s+on\s+teams|shared\s+folder\s+the\s+course\s+uses|uploaded\s+there\s+for\s+reference|parked\s+in\s+the\s+shared\s+folder)\b",
        re.IGNORECASE
    )),
    ("session deferral in Q&A", re.compile(
        r"\b(?:untouched\s+portions\s+are\s+deferred|deferred\s+to\s+a\s+later\s+webinar|deferred\s+to\s+the\s+upcoming\s+session|accepted\s+for\s+the\s+next\s+meeting)\b",
        re.IGNORECASE
    )),
]

PSEUDO_SYMBOL_RE = re.compile(
    r"\([^)]*\bwritten\s+as\s+[a-zA-Z\s,]{4,}[^)]*\)",
    re.IGNORECASE
)


def find_bogus_qa(text):
    """Return [(label, matched_text)] for non-academic/rhetorical Q&A content."""
    hits = []
    for label, rx in BOGUS_QA_PATTERNS:
        for match in rx.finditer(text):
            hits.append((label, match.group(0)))
    return hits


def find_pseudo_symbols(text):
    """Return [matched_snippet] for awkward non-math '(..., written as ...)' occurrences."""
    hits = []
    for m in PSEUDO_SYMBOL_RE.finditer(text):
        snippet = m.group(0)
        if "\\" not in snippet and "mjx-" not in snippet:
            hits.append(snippet)
    return hits


def find_duplicate_sentences(sentences, min_len=30):
    """Return [(sentence, count)] for duplicate sentences of substantial length."""
    from collections import Counter
    cleaned = []
    for s in sentences:
        s_clean = s.strip()
        if len(s_clean) >= min_len:
            if not s_clean.startswith("|") and not s_clean.startswith("#"):
                cleaned.append(s_clean)
    counts = Counter(cleaned)
    return [(s, c) for s, c in counts.items() if c > 1]


# --------------------------------------------------------------------------- #
# 8. Shared cleanup / deduplication / logistics / visual / mojibake helpers
# --------------------------------------------------------------------------- #
_STOPWORDS_OVERLAP = {
    "about", "above", "after", "again", "against", "also", "because", "before",
    "being", "below", "between", "both", "could", "does", "doing", "down",
    "during", "each", "from", "further", "have", "having", "here", "into",
    "just", "more", "most", "only", "other", "over", "same", "should", "some",
    "such", "than", "that", "their", "them", "then", "there", "these", "they",
    "this", "those", "through", "under", "until", "very", "what", "when",
    "where", "which", "while", "with", "would",
}

LECTURE_VOICE_PATTERNS = [
    ("classroom/lecturer framing", re.compile(
        r"\b(?:the\s+(?:professor|lecturer|instructor)|in\s+(?:the\s+)?class|"
        r"from\s+the\s+session|as\s+heard\s+in\s+(?:the\s+)?recording|"
        r"several\s+students\s+asked|live\s+demo)\b",
        re.IGNORECASE,
    )),
    ("transcript keyword/tag tail", re.compile(
        r"(?:^|\n)\s*(?:Keywords|Transcript)\s*:",
        re.IGNORECASE,
    )),
]

LOGISTICS_HEADING_RE = re.compile(
    r"^(?:\d+(?:\.\d+)*\s+)?"
    r"(?:exam\s+(?:guidance(?:\s+summary)?|notes?|revision\s+notes?)|"
    r"the\s+mid-?semester\s+exam\b|comprehensive\s+exam\b|"
    r"assessment\s+plan\b|course\s+overview\s+and\s+expectations\b|"
    r"how\s+the\s+course\s+works\b|course\s+tools,\s*textbooks,\s*and\s+evaluation\b)"
    r"|\bquiz\b",
    re.IGNORECASE,
)

EXAM_CALLOUT_START_RE = re.compile(
    r"^(?:the\s+professor'?s\s+)?(?:exam\s+note|exam\s+tip|on\s+the\s+exam)\s*[:—,-]",
    re.IGNORECASE,
)

CONTENT_FREE_TRANSITION_RE = re.compile(
    r"^(?:"
    r"the\s+explanation\s+below\s+adds\s+the\s+next\s+layer\s+of\s+intuition|"
    r"the\s+visual\s+picture\s+clarifies\s+why\s+the\s+preceding\s+assumption\s+matters|"
    r"a\s+second\s+concrete\s+trace\s+makes\s+the\s+pattern\s+concrete|"
    r"(?:this\s+section\s+shows|in\s+this\s+section\s+we\s+will|let\s+us\s+now)\b[^.!?]{0,70}"
    r")[.!]?$",
    re.IGNORECASE,
)

MOJIBAKE_RE = re.compile(r"â€”|â€“|â€™|â€œ|â€\x9d|Ã©|\ufffd")


def content_tokens(text):
    """Return distinctive lowercase tokens (>=4 chars, non-stopword) for overlap checks."""
    cleaned = re.sub(r"<[^>]+>|\\\[.*?\\\]|\\\(.*?\\\)", " ", str(text), flags=re.DOTALL)
    words = re.findall(r"\b[a-zA-Z]{4,}\b", cleaned.lower())
    return {w for w in words if w not in _STOPWORDS_OVERLAP}


def blocks_overlap(text_a, text_b, threshold=0.80, min_tokens=6):
    """Return True when two text blocks share at least `threshold` of their content tokens."""
    toks_a = content_tokens(text_a)
    toks_b = content_tokens(text_b)
    if len(toks_a) < min_tokens or len(toks_b) < min_tokens:
        return False
    return (len(toks_a & toks_b) / min(len(toks_a), len(toks_b))) >= threshold


def find_lecture_voice_artifacts(text):
    """Return [(label, snippet)] for classroom-voice or transcript-tail residue."""
    hits = []
    for label, rx in LECTURE_VOICE_PATTERNS:
        for match in rx.finditer(text):
            hits.append((label, match.group(0).strip()))
    return hits


def is_logistics_heading(title):
    """Return True if a heading is clearly about exams, quizzes, grading, or admin."""
    return bool(LOGISTICS_HEADING_RE.search(str(title).strip()))


def find_exam_note_callouts(blocks):
    """Return snippets of blocks/paragraphs that start with exam-framed callout labels."""
    hits = []
    for block in blocks:
        plain = re.sub(r"<[^>]+>", " ", str(block))
        plain = re.sub(r"\*+", "", plain).strip()
        if EXAM_CALLOUT_START_RE.match(plain):
            hits.append(plain[:80])
    return hits


def find_content_free_transitions(sentences):
    """Return filler transition sentences carrying no technical payload."""
    return [s.strip() for s in sentences if CONTENT_FREE_TRANSITION_RE.match(s.strip())]


def find_mojibake(text):
    """Return unique mojibake sequences detected in text."""
    return sorted(set(MOJIBAKE_RE.findall(text)))

