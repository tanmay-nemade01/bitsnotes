import { env } from 'cloudflare:workers';

export interface BlogPostFrontmatter {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  draft?: boolean;
  tags?: string[];
  coverImage?: string;
  coverAlt?: string;
  featured?: boolean;
  canonicalUrl?: string;
  author?: string;
}

export interface BlogPost {
  slug: string;
  frontmatter: BlogPostFrontmatter;
  html: string;
}

interface BlogManifestPost {
  slug: string;
  frontmatter: BlogPostFrontmatter;
}

interface BlogManifest {
  version: string;
  updatedAt: string;
  posts: BlogManifestPost[];
}

const htmlGlob = import.meta.glob<string>(
  '/src/content/blog/*/index.html',
  { eager: true, query: '?raw', import: 'default' },
);

const jsonGlob = import.meta.glob<Record<string, unknown>>(
  '/src/content/blog/*/index.json',
  { eager: true, import: 'default' },
);

function getSlug(path: string): string {
  return path.split('/').slice(-2, -1)[0];
}

function toFrontmatter(raw: Record<string, unknown> | BlogPostFrontmatter): BlogPostFrontmatter {
  return {
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    publishedAt: String(raw.publishedAt ?? ''),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    draft: Boolean(raw.draft),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
    coverImage: raw.coverImage ? String(raw.coverImage) : undefined,
    coverAlt: raw.coverAlt ? String(raw.coverAlt) : undefined,
    featured: Boolean(raw.featured),
    canonicalUrl: raw.canonicalUrl ? String(raw.canonicalUrl) : undefined,
    author: raw.author ? String(raw.author) : undefined,
  };
}

function sortByPublishedAt(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    (b.frontmatter.publishedAt || '').localeCompare(a.frontmatter.publishedAt || ''),
  );
}

function buildLocalPosts(): BlogPost[] {
  const posts: BlogPost[] = [];
  const seen = new Set<string>();

  for (const [path, rawHtml] of Object.entries(htmlGlob)) {
    const slug = getSlug(path);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const jsonPath = path.replace(/index\.html$/, 'index.json');
    const rawFm = jsonGlob[jsonPath];
    if (!rawFm?.title) continue;

    posts.push({
      slug,
      frontmatter: toFrontmatter(rawFm),
      html: rawHtml ?? '',
    });
  }

  return sortByPublishedAt(posts);
}

let manifestCache: BlogManifest | null = null;
let lastFetchedTime = 0;
const htmlCache = new Map<string, { html: string; time: number }>();

function postsFromManifest(manifest: BlogManifest): BlogPost[] {
  return sortByPublishedAt(
    manifest.posts.map((p) => ({
      slug: p.slug,
      frontmatter: toFrontmatter(p.frontmatter),
      html: '',
    })),
  );
}

async function getManifest(): Promise<BlogManifest> {
  const now = Date.now();
  if (manifestCache && now - lastFetchedTime < 10000) {
    return manifestCache;
  }

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) {
    console.error('[blogLoader] NOTES_BUCKET binding not found.');
    return { version: 'empty', updatedAt: '', posts: [] };
  }

  try {
    const obj = await bucket.get('blog-manifest.json');
    if (!obj) {
      console.warn('[blogLoader] blog-manifest.json not found in R2 bucket.');
      return { version: 'empty', updatedAt: '', posts: [] };
    }
    const manifest = (await obj.json()) as BlogManifest;
    manifestCache = manifest;
    lastFetchedTime = now;
    return manifest;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[blogLoader] Error fetching blog-manifest.json from R2:', message);
    return { version: 'error', updatedAt: '', posts: [] };
  }
}

async function fetchBlogHtml(slug: string): Promise<string> {
  const now = Date.now();
  const cached = htmlCache.get(slug);
  if (cached && now - cached.time < 10000) return cached.html;

  const bucket = (env as any).NOTES_BUCKET;
  if (!bucket) return '';

  try {
    const obj = await bucket.get(`blog/${slug}/index.html`);
    const html = obj ? await obj.text() : '';
    htmlCache.set(slug, { html, time: now });
    return html;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[blogLoader] Error fetching blog HTML (${slug}):`, message);
    return '';
  }
}

export async function getAllPosts(): Promise<BlogPost[]> {
  if (import.meta.env.DEV) {
    return buildLocalPosts();
  }
  const manifest = await getManifest();
  if (manifest.posts.length > 0) {
    return postsFromManifest(manifest);
  }
  // First deploy before `npm run upload-blog`: serve posts bundled from git.
  return buildLocalPosts();
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts = await getAllPosts();
  return posts.filter((p) => !p.frontmatter.draft);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | undefined> {
  const posts = await getAllPosts();
  const post = posts.find((p) => p.slug === slug);
  if (!post) return undefined;
  if (post.html) return post;
  const html = await fetchBlogHtml(slug);
  return { ...post, html };
}

export async function getPostsByTag(tag: string): Promise<BlogPost[]> {
  const posts = await getPublishedPosts();
  return posts.filter((p) => p.frontmatter.tags?.includes(tag));
}

export async function getFeaturedPosts(): Promise<BlogPost[]> {
  const posts = await getPublishedPosts();
  return posts.filter((p) => p.frontmatter.featured);
}

export function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, '').trim();
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export async function getAllTags(): Promise<string[]> {
  const tags = new Set<string>();
  for (const post of await getPublishedPosts()) {
    for (const tag of post.frontmatter.tags ?? []) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}
