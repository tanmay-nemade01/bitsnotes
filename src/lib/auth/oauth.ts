/**
 * OAuth helpers for Google and GitHub.
 * Handles: authorize URL generation, code exchange, profile fetching.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OAuthProfile {
  provider: string;
  providerUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// ─── Google ─────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function googleAuthorizeUrl(config: OAuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function googleExchangeCode(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<OAuthProfile> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const { access_token } = await res.json<{ access_token: string }>();

  // Fetch user info
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) throw new Error(`Google userinfo failed: ${userRes.status}`);

  const profile = await userRes.json<{
    sub: string;
    email: string;
    email_verified: boolean;
    name: string | null;
    picture: string | null;
  }>();

  return {
    provider: 'google',
    providerUid: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified,
    displayName: profile.name,
    avatarUrl: profile.picture,
  };
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

export function githubAuthorizeUrl(config: OAuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: 'read:user user:email',
  });
  return `${GITHUB_AUTH_URL}?${params}`;
}

export async function githubExchangeCode(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<OAuthProfile> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const { access_token } = await res.json<{ access_token: string }>();

  if (!access_token) throw new Error('No access_token in GitHub response');

  // Fetch user profile
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  });
  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
  const ghUser = await userRes.json<{ id: number; login: string; name: string | null; avatar_url: string | null }>();

  // Fetch emails (GitHub may not include primary email in user endpoint)
  const emailRes = await fetch(GITHUB_EMAILS_URL, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  });
  let primaryEmail = '';
  let emailVerified = false;
  if (emailRes.ok) {
    const emails = await emailRes.json<Array<{ email: string; primary: boolean; verified: boolean }>>();
    const primary = emails.find(e => e.primary);
    if (primary) {
      primaryEmail = primary.email;
      emailVerified = primary.verified;
    } else if (emails.length > 0) {
      primaryEmail = emails[0].email;
      emailVerified = emails[0].verified;
    }
  }

  if (!primaryEmail) throw new Error('No email found on GitHub account');

  return {
    provider: 'github',
    providerUid: String(ghUser.id),
    email: primaryEmail,
    emailVerified,
    displayName: ghUser.name || ghUser.login,
    avatarUrl: ghUser.avatar_url,
  };
}

// ─── PKCE helpers ───────────────────────────────────────────────────────────

/** Generate a random code verifier for PKCE. */
export function generateCodeVerifier(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Derive code challenge from verifier (SHA-256 → base64url). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
