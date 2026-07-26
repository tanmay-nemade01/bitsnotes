export interface Subtopic {
  title: string;
  slug: string;
}

export interface Topic {
  id: string;
  title: string;
  html: string;
  subtopics: Subtopic[];
  slug: string;
}

export interface SplitResult {
  topics: Topic[];
  hasMultipleTopics: boolean;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function getTopicId(titleText: string, index: number): string {
  const match = titleText.trim().match(/^(\d+\.\d+)/);
  if (match) return match[1];

  // Fallback: slugify
  return slugify(titleText) || `topic-${index + 1}`;
}

function parseAndInjectSubtopics(html: string): { subtopics: Subtopic[]; html: string } {
  const subtopics: Subtopic[] = [];
  const usedSlugs = new Set<string>();
  const h3Regex = /<h3([^>]*)>([\s\S]*?)<\/h3>/gi;

  const processedHtml = html.replace(h3Regex, (fullMatch, attrs, innerHtml) => {
    const titleText = stripHtml(innerHtml);

    const isSubtopic =
      /class=["'][^"']*subsection-title[^"']*["']/i.test(attrs) ||
      /^\d+\.\d+\.\d+\b/.test(titleText);

    if (!isSubtopic) {
      return fullMatch;
    }

    let slug = '';
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    if (idMatch) {
      slug = idMatch[1];
    } else {
      const baseSlug = slugify(titleText) || 'subtopic';
      slug = baseSlug;
      let count = 1;
      while (usedSlugs.has(slug)) {
        slug = `${baseSlug}-${count++}`;
      }
      attrs = ` id="${slug}"` + attrs;
    }

    usedSlugs.add(slug);
    subtopics.push({ title: titleText, slug });

    return `<h3${attrs}>${innerHtml}</h3>`;
  });

  return { subtopics, html: processedHtml };
}

export function splitLectureTopics(bodyContent: string): SplitResult {
  // 1. Extract leading style block if present
  let cleanBody = bodyContent;
  const styleMatch = bodyContent.match(/^<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    cleanBody = bodyContent.substring(styleMatch[0].length);
  }

  // Find all H2 tags
  const h2Regex = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi;
  const h2s: { index: number; endIndex: number; attrs: string; innerHtml: string; titleText: string }[] = [];
  let match;

  while ((match = h2Regex.exec(cleanBody)) !== null) {
    const titleText = stripHtml(match[2]);
    const isTopic =
      /class=["'][^"']*section-title[^"']*["']/i.test(match[1]) ||
      /^\d+\.\d+\b/.test(titleText);

    if (isTopic) {
      h2s.push({
        index: match.index,
        endIndex: h2Regex.lastIndex,
        attrs: match[1],
        innerHtml: match[2],
        titleText: titleText,
      });
    }
  }

  // Fallback: zero topics found
  if (h2s.length === 0) {
    const { subtopics, html: processedBody } = parseAndInjectSubtopics(cleanBody);
    return {
      topics: [
        {
          id: 'full',
          title: 'Full lecture',
          html: processedBody,
          subtopics,
          slug: 'full',
        },
      ],
      hasMultipleTopics: false,
    };
  }

  const topics: Topic[] = [];

  // Preamble is before the first topic heading
  const firstH2 = h2s[0];
  const preamble = cleanBody.substring(0, firstH2.index);

  // Parse topics
  for (let i = 0; i < h2s.length; i++) {
    const current = h2s[i];
    const next = h2s[i + 1];

    // HTML content for this topic extends from current H2 to next H2 (or end of cleanBody)
    const topicHtml = next
      ? cleanBody.substring(current.index, next.index)
      : cleanBody.substring(current.index);

    const { subtopics, html: processedTopicHtml } = parseAndInjectSubtopics(topicHtml);

    topics.push({
      id: getTopicId(current.titleText, i),
      title: current.titleText,
      html: processedTopicHtml,
      subtopics,
      slug: slugify(current.titleText),
    });
  }

  // Handle preamble
  if (preamble.trim()) {
    const { subtopics: preambleSubtopics, html: processedPreamble } = parseAndInjectSubtopics(preamble);
    topics[0].html = processedPreamble + topics[0].html;
    topics[0].subtopics = [...preambleSubtopics, ...topics[0].subtopics];
  }

  return {
    topics,
    hasMultipleTopics: topics.length > 1,
  };
}
