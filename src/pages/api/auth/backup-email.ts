/**
 * /api/auth/backup-email
 *   GET    → current backup-email state for the signed-in user
 *   POST   → { email } set/replace backup email (no verification)
 *   DELETE → remove backup email
 *
 * Only users whose primary email matches 2025*@wilp.bits-pilani.ac.in are eligible.
 */

import type { APIRoute } from 'astro';
import {
  getEnv, getUser, json, badRequest, unauthorized, forbidden, getClientIp,
} from '../../../lib/apiHelpers';
import {
  findUserById, findUserByEmail, findUserByBackupEmail, setBackupEmail,
  logAuthEvent,
} from '../../../lib/auth';
import { validateOrigin, csrfForbidden } from '../../../lib/auth/csrf';
import { isBackupEmailEligible, validateBackupEmail } from '../../../lib/auth/backupEmail';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const sessionUser = getUser(context);
  if (!sessionUser) return unauthorized();
  const env = await getEnv(context);
  const row = await findUserById(env.DB, sessionUser.id);
  if (!row) return unauthorized();
  return json({
    eligible: isBackupEmailEligible(row.email),
    backupEmail: row.backup_email ?? null,
    isLocked: Boolean(row.backup_email),
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
  if (!isBackupEmailEligible(row.email)) {
    return forbidden('Backup email is not available for this account.');
  }

  // Backup email is strictly a one-time operation: once added, it cannot be changed.
  if (row.backup_email) {
    return badRequest('Backup email has already been set and cannot be changed.');
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const parsed = validateBackupEmail(body.email, row.email);
  if ('error' in parsed) return badRequest(parsed.error);
  const backup = parsed.email;

  // Must not collide with any account's primary email or another user's backup.
  const [asPrimary, asBackup] = await Promise.all([
    findUserByEmail(env.DB, backup),
    findUserByBackupEmail(env.DB, backup),
  ]);
  if (asPrimary || (asBackup && asBackup.id !== row.id)) {
    return badRequest('That email is already linked to a BitsNotes account.');
  }

  const ok = await setBackupEmail(env.DB, row.id, backup);
  if (!ok) return badRequest('Backup email could not be set or has already been configured.');

  await logAuthEvent(env.DB, {
    userId: row.id, event: 'backup_email_added', ip: getClientIp(request),
    ua: request.headers.get('User-Agent') || '',
  });

  return json({ success: true, backupEmail: backup, isLocked: true });
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
