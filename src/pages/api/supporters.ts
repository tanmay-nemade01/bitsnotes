/**
 * Public supporters API (Wall of Gratitude).
 *
 * GET /api/supporters → { supporters: PublicSupporter[], total: number }
 *
 * Unauthenticated and read-only: the wall is public. The support page renders
 * a static list at build time and then calls this endpoint to swap in the live
 * roster, so adding a supporter from /admin shows up without a redeploy.
 *
 * If D1 is unavailable (local dev before migrations, or a transient failure)
 * we serve the static fallback from `src/data/supporters.ts` so the wall never
 * renders empty.
 */

import type { APIRoute } from 'astro';
import { getEnv, json } from '../../lib/apiHelpers';
import { countSupporters, fallbackSupporterList, listSupporters } from '../../lib/supporters';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const env = await getEnv(context);

  try {
    if (!env.DB) throw new Error('DB binding unavailable');
    const supporters = await listSupporters(env.DB);
    const total = await countSupporters(env.DB);
    return json({ supporters, total }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[api/supporters] falling back to static list:', err);
    const supporters = fallbackSupporterList();
    return json({ supporters, total: supporters.length, fallback: true }, 200, {
      'Cache-Control': 'no-store',
    });
  }
};
