import { defineMiddleware } from 'astro/middleware';

const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://www.google-analytics.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
  "font-src 'self'",
  "frame-src 'self' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://challenges.cloudflare.com",
  "connect-src 'self' https://www.google-analytics.com https://static.cloudflareinsights.com https://pagead2.googlesyndication.com",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspEnforcing = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const noCacheHeader = 'no-store, no-cache, must-revalidate';

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, locals } = context;
  const pathname = url.pathname;

  // ─── Session resolution (lazy imports to avoid startup errors) ───────
  let user: any = null;
  let tier = 'free';

  try {
    const sessionMod = await import('./lib/auth/session');
    const dbMod = await import('./lib/auth/db');
    const cookieHeader = request.headers.get('Cookie');
    const sessionToken = sessionMod.getSessionTokenFromCookie(cookieHeader);
    const signingKey = (context.locals as any).runtime?.env?.SESSION_SIGNING_KEY
      || (context.locals as any).env?.SESSION_SIGNING_KEY
      || '';
    const db = (context.locals as any).runtime?.env?.DB
      || (context.locals as any).env?.DB;

    if (sessionToken && db && signingKey) {
      const claims = await sessionMod.verifyJwt(sessionToken, signingKey);
      if (claims) {
        const dbUser = await dbMod.findUserById(db, claims.sub);
        if (dbUser && dbUser.status === 'active') {
          user = {
            id: dbUser.id,
            email: dbUser.email,
            displayName: dbUser.display_name,
            avatarUrl: dbUser.avatar_url,
            status: dbUser.status,
          };
          tier = claims.tier;
        }
      } else {
        // Access token expired — try refresh
        const refreshToken = sessionMod.getRefreshTokenFromCookie(cookieHeader);
        if (refreshToken && db) {
          const rotated = await sessionMod.verifyRefreshToken(db, refreshToken);
          if (rotated) {
            const dbUser = await dbMod.findUserById(db, rotated.userId);
            if (dbUser && dbUser.status === 'active') {
              const entitlement = await dbMod.getEntitlement(db, rotated.userId);
              tier = entitlement?.tier ?? 'free';
              const newAccessToken = await sessionMod.signJwt(
                { sub: dbUser.id, email: dbUser.email, tier, rt: rotated.newTokenHash },
                signingKey,
              );
              user = {
                id: dbUser.id,
                email: dbUser.email,
                displayName: dbUser.display_name,
                avatarUrl: dbUser.avatar_url,
                status: dbUser.status,
              };
              (locals as any).__newSessionToken = newAccessToken;
              (locals as any).__newRefreshToken = rotated.newToken;
            }
          }
        }
      }
    }
  } catch (err) {
    // Session resolution failed — proceed without auth
    console.error('Session resolution error:', err);
  }

  (locals as any).user = user;
  (locals as any).tier = tier;

  // ─── Auth page redirect: if already signed in, redirect away ─────────
  if (isAuthRoute(pathname) && user && !pathname.includes('signout')) {
    if (pathname === '/auth/signin' || pathname === '/auth/signup') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/' },
      });
    }
  }

  // ─── Execute the route handler ───────────────────────────────────────
  const response = await next();

  // Build mutable headers from the response
  const headers = new Headers(response.headers);

  // ─── Apply security headers to all responses ─────────────────────────
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  // ─── CSP + cache policy for HTML vs API vs auth ─────────────────────
  const contentType = headers.get('content-type') || '';

  if (isAuthRoute(pathname)) {
    // Auth routes: enforcing CSP, no-cache
    headers.set('Content-Security-Policy', cspEnforcing);
    headers.set('Cache-Control', noCacheHeader);
  } else if (contentType.includes('text/html')) {
    // Public pages: report-only CSP
    headers.set('Content-Security-Policy-Report-Only', cspReportOnly);
  }

  // API responses: no-cache
  if (pathname.startsWith('/api/')) {
    headers.set('Cache-Control', noCacheHeader);
  }

  // ─── Set refreshed cookies if applicable ─────────────────────────────
  if ((locals as any).__newSessionToken) {
    try {
      const { setSessionCookie } = await import('./lib/auth/session');
      setSessionCookie(headers, (locals as any).__newSessionToken);
    } catch {}
  }
  if ((locals as any).__newRefreshToken) {
    try {
      const { setRefreshCookie } = await import('./lib/auth/session');
      setRefreshCookie(headers, (locals as any).__newRefreshToken);
    } catch {}
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
