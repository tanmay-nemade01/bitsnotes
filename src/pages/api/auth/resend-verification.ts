/**
 * POST /api/auth/resend-verification
 * Generic response to prevent account enumeration and avoid free-tier outbound email dependency.
 */

import type { APIRoute } from 'astro';
import { getEnv, json } from '../../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;

  // CSRF: validate Origin/Referer
  if (!validateOrigin(request, env.APP_BASE_URL)) {
    return csrfForbidden();
  }

  return json({
    success: true,
    message: 'If your email is registered, check your sign-in provider to verify it.',
  });
};
