import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listSubjects, listLectures } from '../../../utils/notesLoader';
import { getHiddenSubjectNames, SubjectVisibilityUnavailableError } from '../../../lib/subjectVisibility';
import {
  getHiddenLectureKeys,
  makeLectureKey,
  LectureVisibilityUnavailableError,
} from '../../../lib/lectureVisibility';
import { v1CorsHeaders, v1OptionsResponse, checkApiKey } from '../../../lib/cors';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  const corsHeaders = v1CorsHeaders(request, baseUrl);

  if (!checkApiKey(request, (env as any).API_SECRET_KEY)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }),
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const hiddenSubjects = await getHiddenSubjectNames((env as any).DB);
    const hiddenLectures = await getHiddenLectureKeys((env as any).DB);
    const subjects = await listSubjects();
    const result = [];
    for (const s of subjects) {
      if (hiddenSubjects.has(s.name)) continue;
      const lectures = await listLectures(s.name);
      const visibleCount = lectures.filter(
        (l) => !hiddenLectures.has(makeLectureKey(s.name, l.folderName)),
      ).length;
      result.push({
        name: s.name,
        lectureCount: visibleCount,
        slug: encodeURIComponent(s.name)
      });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    if (err instanceof LectureVisibilityUnavailableError) {
      return new Response(
        JSON.stringify({ error: 'Lecture visibility unavailable' }),
        { status: 503, headers: corsHeaders }
      );
    }
    if (err instanceof SubjectVisibilityUnavailableError) {
      return new Response(
        JSON.stringify({ error: 'Subject visibility unavailable' }),
        { status: 503, headers: corsHeaders }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve subjects' }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const baseUrl = (env as any).APP_BASE_URL || 'https://bitsnotes.com';
  return v1OptionsResponse(request, baseUrl);
};
