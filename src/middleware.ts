import { defineMiddleware } from 'astro/middleware';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

// Content-Security-Policy in report-only mode (AdSense/GA/CF beacon/MathJax need testing)
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://www.google-analytics.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
  "font-src 'self'",
  "frame-src 'self' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
  "connect-src 'self' https://www.google-analytics.com https://static.cloudflareinsights.com https://pagead2.googlesyndication.com",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  // Only add headers to HTML responses
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const headers = new Headers(response.headers);

  // Security headers
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  // CSP in report-only mode
  headers.set('Content-Security-Policy-Report-Only', cspReportOnly);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
