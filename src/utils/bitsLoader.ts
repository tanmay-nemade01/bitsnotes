import { env } from 'cloudflare:workers';

export interface BitLink {
  url: string;
  title: string;
  source?: string;
}

export interface BitFrontmatter {
  publishedAt: string;
  draft?: boolean;
  text?: string;
  title?: string;
  image?: string;
  imageAlt?: string;
  link?: BitLink;
  tags?: string[];
}

export interface Bit {
  slug: string;
  frontmatter: BitFrontmatter;
  html: string;
}

interface BitsManifestPost {
  slug: string;
  frontmatter: BitFrontmatter;
}

interface BitsManifest {
  version: string;
  updatedAt: string;
  posts: BitsManifestPost[];
}

const htmlGlob = import.meta.glob<string>(
  '/src/content/bits/*/index.html',
  { eager: true, query: '?raw', import: 'default' },
);

const jsonGlob = import.meta.glob<Record<string, unknown>>(
  '/src/content/bits/*/index.json',
  { eager: true, import: 'default' },
);

function getSlug(path: string): string {
  return path.split('/').slice(-2, -1)[0];
}

function toLink(raw: unknown): BitLink | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const url = rec.url ? String(rec.url) : '';
  if (!url) return undefined;
  return {
    url,
    title: rec.title ? String(rec.title) : url,
    source: rec.source ? String(rec.source) : undefined,
  };
}

function toFrontmatter(raw: Record<string, unknown> | BitFrontmatter): BitFrontmatter {
  return {
    publishedAt: String(raw.publishedAt ?? ''),
    draft: Boolean(raw.draft),
    text: raw.text ? String(raw.text) : undefined,
    title: raw.title ? String(raw.title) : undefined,
    image: raw.image ? String(raw.image) : undefined,
    imageAlt: raw.imageAlt ? String(raw.imageAlt) : undefined,
    link: toLink((raw as Record<string, unknown>).link),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
  };
}

function hasContent(fm: BitFrontmatter, html: string): boolean {
  return Boolean(fm.text?.trim() || fm.image || fm.link || html.trim());
}

function sortByPublishedAt(bits: Bit[]): Bit[] {
  return [...bits].sort((a, b) =>
    (b.frontmatter.publishedAt || '').localeCompare(a.frontmatter.publishedAt || ''),
  );
}

function buildLocalBits(): Bit[] {
  const bits: Bit[] = [];
  const seen = new Set<string>();

  for (const [path, rawFm] of Object.entries(jsonGlob)) {
    const slug = getSlug(path);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const htmlPath = path.replace(/index\.json$/, 'index.html');
    const html = htmlGlob[htmlPath] ?? '';
    const frontmatter = toFrontmatter(rawFm);
    if (!frontmatter.publishedAt || !hasContent(frontmatter, html)) continue;

    bits.push({ slug, frontmatter, html });
  }

  return sortByPublishedAt(bits);
}

let manifestCache: BitsManifest | null = null;
let lastFetchedTime = 0;
const htmlCache = new Map<string, { html: string; time: number }>();

function bitsFromManifest(manifest: BitsManifest): Bit[] {
  return sortByPublishedAt(
    manifest.posts.map((p) => ({
      slug: p.slug,
      frontmatter: toFrontmatter(p.frontmatter as unknown as Record<string, unknown>),
      html: '',
    })),
  );
}

async function getManifest(): Promise<BitsManifest> {
  const now = Date.now();
  if (manifestCache && now - lastFetchedTime < 10000) {
    return manifestCache;
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[bitsLoader] NOTES_BUCKET binding not found.');
    return { version: 'empty', updatedAt: '', posts: [] };
  }

  try {
    const obj = await bucket.get('bits-manifest.json');
    if (!obj) {
      console.warn('[bitsLoader] bits-manifest.json not found in R2 bucket.');
      return { version: 'empty', updatedAt: '', posts: [] };
    }
    const manifest = (await obj.json()) as BitsManifest;
    manifestCache = manifest;
    lastFetchedTime = now;
    return manifest;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[bitsLoader] Error fetching bits-manifest.json from R2:', message);
    return { version: 'error', updatedAt: '', posts: [] };
  }
}

async function fetchBitHtml(slug: string): Promise<string> {
  const now = Date.now();
  const cached = htmlCache.get(slug);
  if (cached && now - cached.time < 10000) return cached.html;

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) return '';

  try {
    const obj = await bucket.get(`bits/${slug}/index.html`);
    const html = obj ? await obj.text() : '';
    htmlCache.set(slug, { html, time: now });
    return html;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bitsLoader] Error fetching bit HTML (${slug}):`, message);
    return '';
  }
}

export async function getAllBits(): Promise<Bit[]> {
  if (import.meta.env.DEV) {
    return buildLocalBits();
  }
  const manifest = await getManifest();
  if (manifest.posts.length > 0) {
    return bitsFromManifest(manifest);
  }
  return buildLocalBits();
}

export async function getPublishedBits(): Promise<Bit[]> {
  const bits = await getAllBits();
  return bits.filter((b) => !b.frontmatter.draft);
}

export async function getBitBySlug(slug: string): Promise<Bit | undefined> {
  const bits = await getAllBits();
  const bit = bits.find((b) => b.slug === slug);
  if (!bit) return undefined;
  if (bit.html) return bit;
  const html = await fetchBitHtml(slug);
  return { ...bit, html };
}

export function bitPreview(bit: Bit, max = 160): string {
  const title = bit.frontmatter.title?.trim();
  if (title) return title;
  const text = bit.frontmatter.text?.replace(/\s+/g, ' ').trim();
  if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  if (bit.frontmatter.link?.title) return bit.frontmatter.link.title;
  if (bit.frontmatter.imageAlt) return bit.frontmatter.imageAlt;
  return 'Bit';
}

export function bitImageSrc(slug: string, filename: string): string {
  const params = new URLSearchParams({ slug, file: filename });
  return `/api/bits/media?${params.toString()}`;
}
