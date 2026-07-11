/**
 * Cryptographic helpers for auth.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */

/** Generate a cryptographically random token (URL-safe base64). */
export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64urlEncode(buf);
}

/** SHA-256 hash → hex string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return uint8ArrayToHex(new Uint8Array(hash));
}

/** HMAC-SHA256 sign → base64url. */
export async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64urlEncode(new Uint8Array(sig));
}

/** HMAC-SHA256 verify. */
export async function hmacVerify(secret: string, payload: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = base64urlDecode(signature);
  return crypto.subtle.verify('HMAC', key, sigBytes as any, new TextEncoder().encode(payload));
}

/** UUID v7 (time-ordered) — monotonic within the same millisecond. */
let _lastTs = 0;
let _seq = 0;
export function uuidv7(): string {
  const now = Date.now();
  if (now === _lastTs) {
    _seq++;
  } else {
    _seq = 0;
    _lastTs = now;
  }
  const timeHex = now.toString(16).padStart(12, '0');
  // 12-bit counter + 62-bit random
  const randBytes = new Uint8Array(10);
  crypto.getRandomValues(randBytes);
  // Inject monotonic counter into first 2 bytes of random portion
  randBytes[0] = (randBytes[0] & 0xf0) | ((_seq >> 8) & 0x0f);
  randBytes[1] = (_seq & 0xff);
  // Set version (7) in byte 6 high nibble, variant (10xx) in byte 8
  randBytes[0] = (randBytes[0] & 0x0f) | 0x70; // version 7
  randBytes[2] = (randBytes[2] & 0x3f) | 0x80; // variant 10xx
  const randHex = uint8ArrayToHex(randBytes);
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${randHex.slice(1, 4)}-${randHex.slice(4, 8)}-${randHex.slice(8, 20)}`;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
