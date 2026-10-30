/**
 * Backup-email eligibility.
 *
 * Only WILP students whose PRIMARY email looks like `2025<anything>@wilp.bits-pilani.ac.in`
 * may add a backup email. Always enforce this server-side; the UI only mirrors it.
 */

const ELIGIBLE_PRIMARY = /^2025[^@\s]*@wilp\.bits-pilani\.ac\.in$/i;

export function isBackupEmailEligible(primaryEmail: string | null | undefined): boolean {
  if (!primaryEmail) return false;
  return ELIGIBLE_PRIMARY.test(primaryEmail.trim());
}
