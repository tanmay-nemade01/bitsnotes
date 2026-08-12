// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// Trigger reload
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
    server: {
      watch: {
        ignored: [
          '**/.wrangler/**',
          '**/dist/**',
          '**/.astro/**',
          '**/playwright-report/**',
          '**/test-results/**',
          '**/.notes-upload-cache.json'
        ]
      }
    },
    optimizeDeps: {
      include: ['obscenity']
    },
    ssr: {
      external: ['cloudflare:email']
    },
  }
});