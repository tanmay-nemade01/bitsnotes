/**
 * Disposable email domain checker.
 *
 * Fetches a community-maintained blocklist from GitHub, caches it in
 * Cloudflare KV for 24 hours, and falls back to a small static list
 * if the network request fails.
 *
 * Source: https://github.com/disposable-email-domains/disposable-email-domains
 */

const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

const KV_CACHE_KEY = 'cache:disposable-email-domains';
const CACHE_TTL_SECONDS = 86_400; // 24 hours

/** Hardcoded fallback used only when the remote fetch fails. */
const STATIC_FALLBACK: ReadonlySet<string> = new Set([
  'mailinator.com',
  'yopmail.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'sharklasers.com',
  'dispostable.com',
  'getairmail.com',
  'burnermail.io',
  'tempmailo.com',
  'throwaway.email',
  'guerrillamailblock.com',
  'grr.la',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.de',
  'trashmail.com',
  'trashmail.me',
  'trashmail.net',
  'maildrop.cc',
  'fakeinbox.com',
  'tempail.com',
  'mohmal.com',
]);

/**
 * Returns a Set of disposable email domains, using KV as a 24-hour cache
 * and GitHub as the upstream source.
 */
export async function getDisposableDomains(
  kv: KVNamespace,
): Promise<ReadonlySet<string>> {
  // 1. Try the KV cache first (fast path)
  try {
    const cached = await kv.get(KV_CACHE_KEY);
    if (cached) {
      return new Set(JSON.parse(cached) as string[]);
    }
  } catch {
    // KV read failed — continue to fetch
  }

  // 2. Fetch fresh list from GitHub
  try {
    const res = await fetch(BLOCKLIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const domains = text
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    // Persist in KV for 24 hours
    try {
      await kv.put(KV_CACHE_KEY, JSON.stringify(domains), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    } catch (e) {
      console.warn('[DisposableEmails] Failed to write KV cache:', e);
    }

    console.log(
      `[DisposableEmails] Fetched and cached ${domains.length} disposable domains.`,
    );
    return new Set(domains);
  } catch (e) {
    console.warn(
      '[DisposableEmails] Remote fetch failed, using static fallback:',
      e,
    );
    return STATIC_FALLBACK;
  }
}

/**
 * Checks whether the given email domain is disposable.
 * Handles exact match and subdomain match (e.g. sub.mailinator.com).
 */
export function isDomainDisposable(
  domain: string,
  blocklist: ReadonlySet<string>,
): boolean {
  if (blocklist.has(domain)) return true;

  // Check parent domains (e.g. "sub.mailinator.com" → "mailinator.com")
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (blocklist.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
