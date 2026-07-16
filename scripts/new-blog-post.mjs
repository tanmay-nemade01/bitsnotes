#!/usr/bin/env node
// Usage: node scripts/new-blog-post.mjs "My Post Title"
// Creates: src/content/blog/my-post-title/index.html + index.json with frontmatter template

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const title = process.argv[2];
if (!title) {
  console.error('Usage: node scripts/new-blog-post.mjs "Post Title"');
  process.exit(1);
}

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const today = new Date().toISOString().split('T')[0];
const dir = resolve(import.meta.dirname, '../src/content/blog', slug);
mkdirSync(dir, { recursive: true });

const jsonTmpl = JSON.stringify({
  title,
  description: '',
  publishedAt: today,
  draft: true,
  tags: [],
}, null, 2);

const htmlTmpl = `<p>Write your post here.</p>
`;

writeFileSync(resolve(dir, 'index.json'), jsonTmpl + '\n');
writeFileSync(resolve(dir, 'index.html'), htmlTmpl);
console.log(`Created blog post: src/content/blog/${slug}/ (draft)`);
