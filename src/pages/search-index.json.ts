import type { APIRoute } from 'astro';
import { listSubjects, listLectures, getLectureContent } from '../utils/notesLoader';

function cleanHtmlText(html: string): string {
  // Strip style tags and content
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  // Strip script tags and content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  // Strip head tags and content
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  // Strip iframe tags and content
  text = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

export const GET: APIRoute = async () => {
  const subjects = listSubjects();
  const index = [];

  for (const subject of subjects) {
    const lectures = listLectures(subject.name);
    for (const lecture of lectures) {
      const content = getLectureContent(subject.name, lecture.folderName);
      if (content) {
        const title = content.metadata?.title ? `${lecture.name} — ${content.metadata.title}` : lecture.name;
        const text = cleanHtmlText(content.htmlContent);
        
        index.push({
          title,
          subject: subject.name,
          folderName: lecture.folderName,
          text
        });
      }
    }
  }

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};
