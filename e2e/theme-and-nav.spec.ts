import { test, expect } from '@playwright/test';

/**
 * Theme + navigation matrix (Phase 9 browser section).
 * Covers: theme applied before paint, persistence, SPA navigation without
 * full reload, and lecture-number visibility.
 */

test.describe('theme before paint', () => {
  test('dark theme is applied before first paint (no FOUC)', async ({ page }) => {
    // Simulate a returning visitor who prefers dark.
    await page.addInitScript(() => {
      localStorage.setItem('bitsnotes-theme', 'dark');
    });
    await page.goto('/');
    // The html element must carry data-theme before any content paints.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
    // No white background flash on <html>.
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });

  test('system theme follows OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
  });

  test('theme persists across reload', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bitsnotes-theme', 'dark'));
    await page.goto('/');
    await page.reload();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
  });
});

test.describe('SPA navigation', () => {
  test('navigating to a subject does not do a full reload', async ({ page }) => {
    await page.goto('/');
    // Capture a marker that survives only in-memory (not re-created on reload).
    await page.evaluate(() => {
      (window as any).__navMarker = 'alive';
    });
    const subjectLink = page.locator('a[href^="/subject/"]').first();
    await expect(subjectLink).toBeVisible();
    await subjectLink.click();
    await expect(page).toHaveURL(/\/subject\//);
    const stillAlive = await page.evaluate(() => (window as any).__navMarker);
    expect(stillAlive).toBe('alive');
  });

  test('back button returns to home without full reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { (window as any).__navMarker = 'alive'; });
    await page.locator('a[href^="/subject/"]').first().click();
    await expect(page).toHaveURL(/\/subject\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => (window as any).__navMarker)).toBe('alive');
  });
});

test.describe('lecture numbers', () => {
  test('subject page shows lecture numbers alongside topic names', async ({ page }) => {
    await page.goto('/');
    const subjectLink = page.locator('a[href^="/subject/"]').first();
    const href = await subjectLink.getAttribute('href');
    await page.goto(href!);
    // At least one resource should render a "Lecture NN" prefix.
    await expect(page.locator('text=/Lecture\\s+\\d{2}/').first()).toBeVisible();
  });
});
