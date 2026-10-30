/**
 * Handles intent: 'link_backup' in the OAuth callback.
 */

import type { AuthDb } from './db';
import type { OAuthProfile } from './oauth';
import type { OAuthStatePayload } from './oauthState';
import type { EnvBindings } from '../apiHelpers';
import { normalizeEmail } from '../apiHelpers';
import {
  findUserById,
  findUserByEmail,
  findUserByBackupEmail,
  findIdentity,
  createIdentity,
  setBackupEmail,
} from './db';
import { isBackupEmailEligible } from './backupEmail';
import { logAuthEvent } from './audit';
import { clearOAuthStateCookie } from './session';

export interface BackupLinkOptions {
  db: AuthDb;
  env: EnvBindings;
  request: Request;
  profile: OAuthProfile;
  stateData: OAuthStatePayload;
  ip?: string;
}

function redirectWithError(code: string, request: Request): Response {
  const headers = new Headers({
    Location: `/account?backup_error=${code}`,
    'Cache-Control': 'no-store',
  });
  clearOAuthStateCookie(headers, request);
  return new Response(null, { status: 302, headers });
}

export async function handleBackupLink({
  db,
  request,
  profile,
  stateData,
  ip,
}: BackupLinkOptions): Promise<Response> {
  // Check 1: provider must be google, linkUserId must be present
  if (stateData.provider !== 'google' || !stateData.linkUserId) {
    return redirectWithError('invalid', request);
  }

  // Check 2: owner exists, active, and eligible
  const owner = await findUserById(db, stateData.linkUserId);
  if (!owner || owner.status !== 'active' || !isBackupEmailEligible(owner.email)) {
    return redirectWithError('not_eligible', request);
  }

  // Check 3: backup email not already set
  if (owner.backup_email_verified_at != null) {
    return redirectWithError('already_set', request);
  }

  // Check 4: provider reports email as verified
  if (profile.emailVerified !== true) {
    return redirectWithError('unverified', request);
  }

  // Check 5: cannot be the same as primary email
  const email = normalizeEmail(profile.email);
  if (email === owner.email) {
    return redirectWithError('same_as_primary', request);
  }

  // Check 6: email does not belong to another existing account
  const userByEmail = await findUserByEmail(db, email);
  if (userByEmail && userByEmail.id !== owner.id) {
    return redirectWithError('has_account', request);
  }

  // Check 7: email is not already another user's backup email
  const userByBackup = await findUserByBackupEmail(db, email);
  if (userByBackup && userByBackup.id !== owner.id) {
    return redirectWithError('already_backup', request);
  }

  // Check 8: provider UID is not already claimed by another user
  const existingIdentity = await findIdentity(db, 'google', profile.providerUid);
  if (existingIdentity && existingIdentity.user_id !== owner.id) {
    return redirectWithError('identity_taken', request);
  }

  // Check 9: setBackupEmail
  const setOk = await setBackupEmail(db, owner.id, email);
  if (!setOk) {
    return redirectWithError('already_set', request);
  }

  // Link identity if not already linked
  if (!existingIdentity) {
    await createIdentity(db, owner.id, 'google', profile.providerUid);
  }

  // Log audit event
  await logAuthEvent(db, {
    userId: owner.id,
    event: 'backup_email_added',
    provider: 'google',
    ip,
    ua: request.headers.get('User-Agent') || '',
  });

  // Success redirect
  const headers = new Headers({
    Location: '/account?backup=linked',
    'Cache-Control': 'no-store',
  });
  clearOAuthStateCookie(headers, request);
  return new Response(null, { status: 302, headers });
}

