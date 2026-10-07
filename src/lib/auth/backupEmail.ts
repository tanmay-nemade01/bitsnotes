/**
 * Backup-email eligibility + validation.
 *
 * Only WILP students whose PRIMARY email looks like `2025<anything>@wilp.bits-pilani.ac.in`
 * may add a backup email. Always enforce this server-side; the UI only mirrors it.
 */

const ELIGIBLE_PRIMARY = /^2025[^@\s]*@wilp\.bits-pilani\.ac\.in$/i;
const BASIC_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isBackupEmailEligible(primaryEmail: string | null | undefined): boolean {
  if (!primaryEmail) return false;
  return ELIGIBLE_PRIMARY.test(primaryEmail.trim());
}

/**
 * Returns a normalized backup email, or an error string.
 */
export function validateBackupEmail(
  raw: unknown,
  primaryEmail: string,
): { email: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Backup email is required.' };
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !BASIC_EMAIL.test(email)) {
    return { error: 'Enter a valid email address.' };
  }
  if (email === primaryEmail.trim().toLowerCase()) {
    return { error: 'Backup email must be different from your main email.' };
  }
  return { email };
}
