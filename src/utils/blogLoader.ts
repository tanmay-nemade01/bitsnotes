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

function buildPosts(): BlogPost[] {
  const posts: BlogPost[] = [];
  const seen = new Set<string>();

  for (const [path, rawHtml] of Object.entries(htmlGlob)) {
    const slug = getSlug(path);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const jsonPath = path.replace(/index\.html$/, 'index.json');
    const rawFm = jsonGlob[jsonPath] as unknown as BlogPostFrontmatter | undefined;

    if (!rawFm?.title) continue;

    posts.push({
      slug,
      frontmatter: {
        title: rawFm.title,
        description: rawFm.description ?? '',
        publishedAt: rawFm.publishedAt ?? '',
        updatedAt: rawFm.updatedAt,
        draft: rawFm.draft,
        tags: rawFm.tags,
        coverImage: rawFm.coverImage,
        coverAlt: rawFm.coverAlt,
        featured: rawFm.featured,
        canonicalUrl: rawFm.canonicalUrl,
        author: rawFm.author,
      },
      html: rawHtml ?? '',
    });
  }

  return posts;
}

const allPosts = buildPosts();

export function getAllPosts(): BlogPost[] {
  return allPosts;
}

export function getPublishedPosts(): BlogPost[] {
  return allPosts.filter((p) => !p.frontmatter.draft);
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return allPosts.find((p) => p.slug === slug);
}

export function getPostsByTag(tag: string): BlogPost[] {
  return getPublishedPosts().filter((p) => p.frontmatter.tags?.includes(tag));
}

export function getFeaturedPosts(): BlogPost[] {
  return getPublishedPosts().filter((p) => p.frontmatter.featured);
}

export function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, '').trim();
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const post of getPublishedPosts()) {
    for (const tag of post.frontmatter.tags ?? []) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}
