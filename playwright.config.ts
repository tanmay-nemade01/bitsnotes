import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the BitsNotes browser test matrix (Phase 9).
 *
 * These tests run against a *built* site served locally. They cover the
 * dark-mode-before-paint guarantee, SPA navigation without full reload,
 * browse-all / filters, lecture numbers, comments, usefulness feedback, and
 * the Support copy button. They are intentionally representative rather than
 * exhaustive — the full light/dark/mobile/security/perf regression is a
 * manual checklist (see test/visual-matrix.md).
 *
 * Run:
 *   npm run build
 *   npx playwright test
 *
 * The base URL defaults to the Wrangler preview; override with BASE_URL.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    // Build is expected to have run already; this just serves the static output.
    command: 'npm run preview -- --port 4321 --host',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
