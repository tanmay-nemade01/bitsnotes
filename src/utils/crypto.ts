/**
 * Generates a 256-bit cryptographically secure hex token.
 * Used for confirmation links and unsubscribe tokens.
 * Works in Cloudflare Workers runtime (Web Crypto API).
 */
export function generateSecureToken(): string {
  const tokenArray = new Uint8Array(32);
  crypto.getRandomValues(tokenArray);
  return Array.from(tokenArray, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
