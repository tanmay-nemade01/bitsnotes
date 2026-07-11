/**
 * Cloudflare Turnstile server-side verification.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile token server-side.
 * @param secretKey - Turnstile secret key (from Cloudflare dashboard)
 * @param token - The `cf-turnstile-response` form field value
 * @param remoteIp - The connecting client's IP (from request headers)
 */
export async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  });

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    return { success: false, 'error-codes': [`http_${res.status}`] };
  }

  return res.json<TurnstileResult>();
}
