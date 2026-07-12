// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  adapter: cloudflare(),
  prefetch: {
    // Do NOT prefetch every link on the page (100+ lectures). Only links that
    // explicitly opt in via `data-astro-prefetch` are prefetched, on hover/tap.
    prefetchAll: false,
    defaultStrategy: 'tap',
  },
  build: {
    // Emit cacheable, content-hashed stylesheet files (instead of inlining
    // every stylesheet into each HTML document). This lets the browser and
    // edge cache reuse CSS across navigations, cutting HTML size and TTFB.
    inlineStylesheets: 'never',
  },

  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ['cloudflare:email']
    },
  }
});