import { hmacSign, hmacVerify } from './crypto';
import { isSecure } from './session';

export type OAuthIntent = 'login' | 'link_backup';

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  provider: 'google' | 'github';
  redirect: string | null;
  intent: OAuthIntent;
  linkUserId: string | null;
  issuedAt: number;
}

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export async function encodeOAuthState(payload: OAuthStatePayload, signingKey: string): Promise<string> {
  const jsonStr = JSON.stringify(payload);
  const payloadB64 = btoa(jsonStr);
  const sig = await hmacSign(signingKey, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function decodeOAuthState(cookieValue: string, signingKey: string): Promise<OAuthStatePayload | null> {
  try {
    const dotIdx = cookieValue.lastIndexOf('.');
    if (dotIdx === -1) return null;
    const payloadB64 = cookieValue.slice(0, dotIdx);
    const sig = cookieValue.slice(dotIdx + 1);

    const valid = await hmacVerify(signingKey, payloadB64, sig);
    if (!valid) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(atob(payloadB64));
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.state !== 'string' || !parsed.state) return null;
    if (typeof parsed.codeVerifier !== 'string' || !parsed.codeVerifier) return null;
    if (parsed.provider !== 'google' && parsed.provider !== 'github') return null;
    if (typeof parsed.issuedAt !== 'number') return null;

    if (Date.now() - parsed.issuedAt > OAUTH_STATE_MAX_AGE_MS) return null;

    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      provider: parsed.provider,
      redirect: typeof parsed.redirect === 'string' ? parsed.redirect : null,
      intent: (parsed.intent === 'link_backup' ? 'link_backup' : 'login') as OAuthIntent,
      linkUserId: typeof parsed.linkUserId === 'string' ? parsed.linkUserId : null,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

export function oauthStateCookie(token: string, request: Request): string {
  const secure = isSecure(request) ? ' Secure;' : '';
  return `__oauth_state=${token}; Path=/api/auth/callback; HttpOnly;${secure} SameSite=Lax; Max-Age=600`;
}

