import { defineMiddleware } from 'astro/middleware';
import { env } from 'cloudflare:workers';

const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-Robots-Tag': 'noarchive',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://www.google-analytics.com",
  "font-src 'self'",
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self' https://www.google-analytics.com https://static.cloudflareinsights.com",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspEnforcing = [
  "default-src 'self'",
  // No 'unsafe-eval' on auth/admin — Turnstile + Astro inline scripts use 'unsafe-inline' only.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
  "font-src 'self'",
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "navigate-to 'self' https://github.com https://accounts.google.com",
].join('; ');

const noCacheHeader = 'no-store, no-cache, must-revalidate';

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/');
}

// Secret admin area. Kept as a single source of truth so a rename only touches
// this constant. Obscurity is a bonus, not the defence — membership in the
// `admin_users` table is what actually authorises access.
const BACKSTAGE_PREFIX = '/backstage';
function isBackstageRoute(pathname: string): boolean {
  return pathname === BACKSTAGE_PREFIX || pathname.startsWith(BACKSTAGE_PREFIX + '/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, locals } = context;
  const pathname = url.pathname;


  // ─── Cheap early exit: static assets never need auth ────────────────
  // Skip cookie parsing and all session/DB imports for assets, fonts, and
  // other static files. This keeps the hot path (public HTML, CSS, JS, fonts)
  // free of any D1/Workers auth work (Phase 8.7).
  const isAsset = /\.(css|js|woff2?|ttf|otf|png|jpeg|jpg|gif|svg|webp|ico|webmanifest|txt|xml|json|map)$/i.test(pathname)
    || pathname.startsWith('/fonts/')
    || pathname === '/favicon.ico'
    || pathname === '/robots.txt'
    || pathname === '/sitemap.xml';

  // ─── Session resolution (lazy imports to avoid startup errors) ───────
  let user: any = null;
  let tier = 'free';

  // Signout must never mint a fresh session: it runs after this middleware,
  // and any rotated tokens issued here would overwrite the clearing cookies
  // the signout handler sets (requiring a second click to log out).
  // We still resolve the JWT so the handler can revoke all tokens, but we
  // skip refresh-token rotation for this route.
  const isSignout = pathname === '/api/auth/signout';

  if (!isAsset) {
    const cookieHeader = request.headers.get('Cookie') || '';
    // Cheap cookie inspection BEFORE importing any session/DB module: only
    // proceed with the (heavier) auth flow if a session cookie is actually
    // present. Signed-out requests skip all D1 work.
    const hasSessionCookie = /(?:^|;\s*)(__session|__rt)=/.test(cookieHeader);

    if (hasSessionCookie) {
      try {
        const sessionMod = await import('./lib/auth/session');
        const dbMod = await import('./lib/auth/db');
        const sessionToken = sessionMod.getSessionTokenFromCookie(cookieHeader);
        const signingKey = (env as any).SESSION_SIGNING_KEY || '';
        const db = (env as any).DB;

        if (db && signingKey) {
          let claims = null;
          if (sessionToken) {
            claims = await sessionMod.verifyJwt(sessionToken, signingKey);
            if (claims && (await sessionMod.isAccessTokenRevoked(db, claims.rt))) {
              claims = null;
            }
          }

          if (claims) {
            const dbUser = await dbMod.findUserById(db, claims.sub);
            if (dbUser && dbUser.status === 'active') {
              const accessExpiresAt = dbUser.access_expires_at != null ? Number(dbUser.access_expires_at) : null;
              user = {
                id: dbUser.id,
                email: dbUser.email,
                displayName: dbUser.display_name,
                avatarUrl: dbUser.avatar_url,
                status: dbUser.status,
                backupEmail: dbUser.backup_email ?? null,
                tags: dbUser.tags ?? 'normal',
                accessExpiresAt,
                isAccessExpired: accessExpiresAt != null && Date.now() > accessExpiresAt,
              };
              tier = claims.tier;
            }
          } else if (!isSignout) {
            // Access token missing or expired — try refresh.
            // Skipped for signout so logout never mints a fresh session
            // that would overwrite the handler's clearing cookies.
            const refreshToken = sessionMod.getRefreshTokenFromCookie(cookieHeader);
            if (refreshToken) {
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
                  const accessExpiresAt = dbUser.access_expires_at != null ? Number(dbUser.access_expires_at) : null;
                  user = {
                    id: dbUser.id,
                    email: dbUser.email,
                    displayName: dbUser.display_name,
                    avatarUrl: dbUser.avatar_url,
                    status: dbUser.status,
                    backupEmail: dbUser.backup_email ?? null,
                    tags: dbUser.tags ?? 'normal',
                    accessExpiresAt,
                    isAccessExpired: accessExpiresAt != null && Date.now() > accessExpiresAt,
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
    }
  }

  let isAdmin = false;
  if (user) {
    const adminDb = (env as any).DB;
    if (adminDb) {
      try {
        const row = await adminDb
          .prepare('SELECT user_id FROM admin_users WHERE user_id = ?')
          .bind(user.id)
          .first();
        isAdmin = !!row;
      } catch (err) {
        console.error('[middleware] admin check failed:', err);
      }
    }
    // Admins never have their access expired
    user.isAccessExpired = Boolean(user.isAccessExpired && !isAdmin);
  }

  (locals as any).user = user;
  (locals as any).tier = tier;
  (locals as any).isAdmin = isAdmin;
  (locals as any).isAccessExpired = Boolean(user?.isAccessExpired);

  // ─── Admin (/backstage) access gate ─────────────────────────────────
  // Signed out  → redirect to sign-in (preserving the intended destination).
  // Non-admin   → 404 (do not reveal that the area exists).
  // Admins      → mark the request and record a best-effort audit event.
  if (isBackstageRoute(pathname)) {
    if (!user) {
      const redirect = new URL('/auth/signin', url.origin);
      redirect.searchParams.set('redirect', pathname);
      return new Response(null, {
        status: 302,
        headers: { Location: redirect.pathname + redirect.search },
      });
    }

    if (!isAdmin) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }

    if (request.method === 'GET') {
      try {
        const { logAuthEvent } = await import('./lib/auth');
        const adminDb = (env as any).DB;
        await logAuthEvent(adminDb, {
          userId: user.id,
          event: 'admin_dashboard_view',
          ip: request.headers.get('CF-Connecting-IP') || '',
          ua: request.headers.get('User-Agent') || '',
        });
      } catch {
        // best-effort
      }
    }
  }

  // ─── Legacy /auth/signup URL: sign-in auto-creates accounts ──────────
  // There is no separate signup page (OAuth upserts on first sign-in),
  // so preserve old links/bookmarks by redirecting to signin.
  if (pathname === '/auth/signup' || pathname === '/auth/signup/') {
    const redirect = new URL('/auth/signin', url.origin);
    redirect.search = url.search;
    return new Response(null, {
      status: 302,
      headers: { Location: redirect.pathname + redirect.search + url.hash },
    });
  }

  // ─── Auth page redirect: if already signed in, redirect away ─────────
  if (isAuthRoute(pathname) && user && !pathname.includes('signout')) {
    if (pathname === '/auth/signin') {
      return new Response(null, {
        status: 302,
        headers: { Location: '/' },
      });
    }
  }

  // ─── Execute the route handler ───────────────────────────────────────
  let response: Response;
  try {
    response = await next();
  } catch (err) {
    console.error('[middleware] SSR render error:', err);
    // Return a proper error page instead of an empty response (blank screen).
    // API routes get a JSON error; HTML pages get a styled 500 page.
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    // For HTML pages, return a minimal styled error page so the user sees
    // something actionable instead of a blank white screen.
    const errorHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>500 — BitsNotes</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#FAF9F6;color:#1A1916}main{text-align:center;padding:2rem}h1{font-size:2rem;margin:0}p{margin:0.5rem 0;color:#48453F}a{color:#0F766E}</style></head><body><main><h1>500</h1><p>Something went wrong. Please try again in a moment.</p><p><a href="/">Return home</a></p></main></body></html>`;
    return new Response(errorHtml, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // ─── Return original response for null-body statuses ────────────────
  // Statuses like 304 (Not Modified) or 204 (No Content) must not have a body
  // and constructing a new Response with them will throw a TypeError in Cloudflare Workers (workerd).
  const nullBodyStatuses = [101, 204, 205, 304];
  if (nullBodyStatuses.includes(response.status)) {
    return response;
  }

  // Build mutable headers from the response
  const headers = new Headers(response.headers);

  // Delete Content-Length and Content-Encoding to prevent Cloudflare edge from truncating the body
  headers.delete('content-length');
  headers.delete('content-encoding');

  // ─── Apply security headers to all responses ─────────────────────────
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  // ─── CSP + cache policy for HTML vs API vs auth ─────────────────────
  const contentType = headers.get('content-type') || '';
  if (isAuthRoute(pathname) || isBackstageRoute(pathname)) {
    // Auth and Admin routes: enforcing CSP, no-cache
    headers.set('Content-Security-Policy', cspEnforcing);
    headers.set('Cache-Control', noCacheHeader);
  } else if (contentType.includes('text/html')) {
    // Public pages: report-only CSP
    headers.set('Content-Security-Policy-Report-Only', cspReportOnly);

    // Cache public page shells at the edge ONLY when the request is anonymous
    // (signed-out). Signed-in responses, admin pages, and any mutation route
    // stay no-store so personalized UI is never served from cache (Phase 8.10).
    const isAdmin = isBackstageRoute(pathname);
    const isMutation = request.method !== 'GET' && request.method !== 'HEAD';
    // Lecture notes (/view/) are gated per-viewer (verified bot vs anonymous teaser vs
    // signed-in), so a cached copy could leak full notes to anonymous users or serve
    // a teaser to Googlebot. Always no-store there.
    const isGatedNotes = pathname.startsWith('/view/');
    if (!user && !isAdmin && !isMutation && !isGatedNotes) {
      // Edge-only caching: s-maxage lets Cloudflare cache anonymous page shells,
      // but no `max-age`/`public` means browsers never store HTML — so a page
      // cached while signed-out can never be shown to a just-signed-in user.
      headers.set('Cache-Control', 's-maxage=300, stale-while-revalidate=600, must-revalidate');
      const vary = headers.get('Vary');
      if (vary) {
        if (!vary.includes('Cookie')) {
          headers.set('Vary', `${vary}, Cookie`);
        }
      } else {
        headers.set('Vary', 'Cookie');
      }
    } else {
      headers.set('Cache-Control', noCacheHeader);
    }
  }

  // API responses: no-cache (auth/bookmarks/admin/mutations must never be cached)
  if (pathname.startsWith('/api/')) {
    headers.set('Cache-Control', noCacheHeader);
  }

  // ─── Set refreshed cookies if applicable ─────────────────────────────
  // Never re-set a session on a response that clears it (e.g. signout):
  // the clearing cookies must win, otherwise logout appears to fail.
  const setCookies: string[] = typeof (headers as any).getSetCookie === 'function'
    ? (headers as any).getSetCookie()
    : (headers.get('Set-Cookie')?.split(/,(?=[^;,]+=[^;,]*;)/) ?? []);
  const clearsSession = setCookies.some(
    (c) => /__session=;/.test(c) || /__rt=;/.test(c),
  );
  if (!clearsSession) {
    if ((locals as any).__newSessionToken) {
      try {
        const { setSessionCookie } = await import('./lib/auth/session');
        setSessionCookie(headers, (locals as any).__newSessionToken, request);
      } catch {}
    }
    if ((locals as any).__newRefreshToken) {
      try {
        const { setRefreshCookie } = await import('./lib/auth/session');
        setRefreshCookie(headers, (locals as any).__newRefreshToken, request);
      } catch {}
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
