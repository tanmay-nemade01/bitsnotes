/**
 * Verified search-engine crawler detection.
 *
 * A bot is "verified" only if BOTH hold:
 *   1. its User-Agent claims to be Googlebot / Bingbot (or another listed crawler), and
 *   2. its source IP is inside that engine's officially published IP ranges
 *      (or Cloudflare itself marks it as a verified bot).
 *
 * The UA alone is trivially spoofable, so it is never trusted by itself. Verified
 * crawlers receive the full note HTML (so SEO is preserved); everyone else who is
 * signed out gets a teaser + login wall. Google documents this pattern for gated
 * content ("flexible sampling" / paywalled-content structured data) and verifying
 * the crawler by IP range is the supported way to avoid it counting as cloaking.
 */

interface CrawlerSpec {
  uaPattern: RegExp;
  rangesUrl: string;
}

const CRAWLERS: CrawlerSpec[] = [
  {
    uaPattern: /Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Storebot-Google/i,
    rangesUrl: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  },
  {
    uaPattern: /Googlebot|Google-InspectionTool|GoogleOther/i,
    rangesUrl: 'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
  },
  {
    uaPattern: /bingbot|BingPreview|msnbot/i,
    rangesUrl: 'https://www.bing.com/toolbox/bingbot.json',
  },
];

const RANGE_TTL_MS = 24 * 60 * 60 * 1000;
const rangeCache = new Map<string, { at: number; cidrs: string[] }>();

// ─── IP / CIDR helpers (IPv4 + IPv6, BigInt based) ──────────────────────────

function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  if (ip.includes(':')) {
    // IPv6 (handle ::, and embedded IPv4 tail)
    let addr = ip.split('%')[0];
    const v4tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4tail) {
      const p = v4tail[1].split('.').map(Number);
      if (p.some((x) => x > 255)) return null;
      const hi = ((p[0] << 8) | p[1]).toString(16);
      const lo = ((p[2] << 8) | p[3]).toString(16);
      addr = addr.replace(v4tail[1], `${hi}:${lo}`);
    }
    const halves = addr.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
    const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail];
    let n = 0n;
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      n = (n << 16n) | BigInt(parseInt(g, 16));
    }
    return { v: 6, n };
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(Number(p));
  }
  return { v: 4, n };
}

function ipInCidr(ip: { v: 4 | 6; n: bigint }, cidr: string): boolean {
  const [base, lenStr] = cidr.split('/');
  const parsed = parseIp(base);
  if (!parsed || parsed.v !== ip.v) return false;
  const bits = ip.v === 4 ? 32 : 128;
  const len = lenStr === undefined ? bits : Number(lenStr);
  if (!Number.isInteger(len) || len < 0 || len > bits) return false;
  const shift = BigInt(bits - len);
  return (ip.n >> shift) === (parsed.n >> shift);
}

async function loadRanges(url: string): Promise<string[]> {
  const cached = rangeCache.get(url);
  if (cached && Date.now() - cached.at < RANGE_TTL_MS) return cached.cidrs;
  try {
    const res = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { prefixes?: Array<{ ipv4Prefix?: string; ipv6Prefix?: string }> };
    const cidrs = (data.prefixes ?? [])
      .map((p) => p.ipv4Prefix || p.ipv6Prefix || '')
      .filter(Boolean);
    rangeCache.set(url, { at: Date.now(), cidrs });
    return cidrs;
  } catch (err) {
    console.error('[searchBots] failed to load IP ranges', url, err);
    // Serve stale data if we have it; otherwise fail CLOSED (treated as non-bot).
    return cached?.cidrs ?? [];
  }
}

/**
 * True only for genuine, IP-verified search-engine crawlers.
 */
export async function isVerifiedSearchBot(request: Request): Promise<boolean> {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua) return false;

  // Cloudflare-verified bots (available on plans with Bot Management).
  const cf = (request as any).cf;
  if (cf?.botManagement?.verifiedBot === true) return true;

  const matching = CRAWLERS.filter((c) => c.uaPattern.test(ua));
  if (matching.length === 0) return false;

  const rawIp = request.headers.get('CF-Connecting-IP');
  const ip = rawIp ? parseIp(rawIp.trim()) : null;
  if (!ip) return false;

  for (const crawler of matching) {
    const cidrs = await loadRanges(crawler.rangesUrl);
    if (cidrs.some((c) => ipInCidr(ip, c))) return true;
  }
  return false;
}
