#!/usr/bin/env node
// Usage: node scripts/new-bits-post.mjs "optional title or slug words"
// Creates: src/content/bits/{slug}/index.json (draft)

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const input = process.argv[2] || '';
const slug = (input
  ? input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  : `bit-${Date.now()}`) || `bit-${Date.now()}`;

const dir = resolve(import.meta.dirname, '../src/content/bits', slug);
mkdirSync(dir, { recursive: true });

const jsonTmpl = JSON.stringify({
  publishedAt: new Date().toISOString(),
  draft: true,
  text: '',
  title: input || '',
  tags: [],
}, null, 2);

writeFileSync(resolve(dir, 'index.json'), jsonTmpl + '\n');
console.log(`Created bit: src/content/bits/${slug}/ (draft)`);
console.log('Add text, optional image, and/or link, set draft: false, then npm run upload-bits');
