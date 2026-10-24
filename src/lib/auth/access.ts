/**
 * User access control & tagging logic.
 *
 * Requirements:
 * 1. Default free access period: until 15th March 2027 23:59:59.999 UTC.
 * 2. Automatic tags:
 *    - Follows BITS Pilani pattern (ends in bits-pilani.ac.in) → 'batchmate'
 *    - Otherwise → 'normal'
 * 3. Timed access verification & admin overrides.
 */

/**
 * 15th March 2027, 23:59:59.999 UTC in epoch milliseconds.
 * (new Date(Date.UTC(2027, 2, 15, 23, 59, 59, 999)).getTime() === 1805155199999)
 */
export const DEFAULT_ACCESS_EXPIRES_AT = 1805155199999;

/**
 * Check if an email matches the BITS Pilani pattern.
 * Matches:
 *  - *@wilp.bits-pilani.ac.in
 *  - *@pilani.bits-pilani.ac.in
 *  - *@goa.bits-pilani.ac.in
 *  - *@hyderabad.bits-pilani.ac.in
 *  - *@bits-pilani.ac.in
 */
export function isBitsPilaniEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return /(?:^|[.@])bits-pilani\.ac\.in$/i.test(clean);
}

/**
 * Check if an email qualifies for the 'batchmate' tag.
 * Conditions:
 * 1. Must follow BITS Pilani pattern (*@*.bits-pilani.ac.in or *@bits-pilani.ac.in).
 * 2. Must start with '2025'.
 */
export function isBatchmateEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return clean.startsWith('2025') && isBitsPilaniEmail(clean);
}

/**
 * Determine default user tag based on email address.
 */
export function getUserDefaultTag(email: string | null | undefined): 'batchmate' | 'normal' {
  return isBatchmateEmail(email) ? 'batchmate' : 'normal';
}

/**
 * Check whether a user's access has expired.
 * Admin users never expire.
 * A null accessExpiresAt means indefinite/unlimited access.
 */
export function isUserAccessExpired(
  user: { accessExpiresAt?: number | null; access_expires_at?: number | null } | null | undefined,
  isAdmin?: boolean,
): boolean {
  if (!user) return false;
  if (isAdmin) return false;
  const expiresAt = user.accessExpiresAt !== undefined ? user.accessExpiresAt : user.access_expires_at;
  if (expiresAt == null) return false;
  return Date.now() > expiresAt;
}

/**
 * Format timestamp into a human-friendly date string for access displays (e.g. "15 Mar 2027").
 */
export function formatAccessDate(ts: number | null | undefined): string {
  if (!ts) return 'Indefinite';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}
