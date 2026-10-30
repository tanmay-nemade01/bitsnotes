/**
 * /api/auth/backup-email
 *   GET    → current backup-email state for the signed-in user
 *   POST   → deprecated: returns 410 Gone (no direct typing of backup emails)
 *   DELETE → remove backup email (blocked: cannot be removed once set)
 *
 * Only users whose primary email matches 2025*@wilp.bits-pilani.ac.in are eligible.
 */

import type { APIRoute } from 'astro';
import {
  getEnv,
  getUser,
  json,
  badRequest,
  unauthorized,
} from '../../../lib/apiHelpers';
import { findUserById } from '../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { isBackupEmailEligible } from '../../../lib/auth/backupEmail';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const sessionUser = getUser(context);
  if (!sessionUser) return unauthorized();
  const env = await getEnv(context);
  const row = await findUserById(env.DB, sessionUser.id);
  if (!row) return unauthorized();

  const isLocked = row.backup_email_verified_at != null;
  return json({
    eligible: isBackupEmailEligible(row.email),
    backupEmail: isLocked ? (row.backup_email ?? null) : null,
    isLocked,
  });
};

export const POST: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  if (!validateOrigin(request, env.APP_BASE_URL)) return csrfForbidden();

  const sessionUser = getUser(context);
  if (!sessionUser) return unauthorized();

  const row = await findUserById(env.DB, sessionUser.id);
  if (!row || row.status !== 'active') return unauthorized();

  return json(
    { error: 'Typing a backup email is no longer supported. Use "Link backup Google account" on your account page.' },
    410,
  );
};

export const DELETE: APIRoute = async (context) => {
  const env = await getEnv(context);
  const request = context.request;
  if (!validateOrigin(request, env.APP_BASE_URL)) return csrfForbidden();

  const sessionUser = getUser(context);
  if (!sessionUser) return unauthorized();

  // Backup email is one-time and cannot be removed once configured.
  return badRequest('Backup email cannot be removed or changed once set.');
};
