/**
 * Test shim for `cloudflare:workers`.
 *
 * The production code calls `import('cloudflare:workers')` to read env
 * bindings (DB, rate limiters, secrets). In tests we don't have a real
 * Worker runtime, so this module exports a mutable `env` object that tests
 * populate via `setTestEnv()`. `getEnv()` in src/lib/getEnv.ts caches the
 * first result, so tests must set the env BEFORE the first `getEnv()` call
 * (or reset the module cache).
 */

export const env: Record<string, unknown> = {};

export function setTestEnv(partial: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(partial)) {
    env[k] = v;
  }
}

export function resetTestEnv(): void {
  for (const k of Object.keys(env)) delete env[k];
}
