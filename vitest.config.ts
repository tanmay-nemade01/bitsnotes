/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // The codebase imports `cloudflare:workers` and uses Web Crypto. Node 24
    // provides Web Crypto globally, so we only need to shim the module.
    alias: {
      'cloudflare:workers': new URL('./test/cloudflare-shim.ts', import.meta.url).pathname,
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
