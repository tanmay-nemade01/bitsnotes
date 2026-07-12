import { test, expect } from '@playwright/test';

/**
 * Comments + usefulness feedback e2e (Phase 9 browser section).
 * These exercise the client UI against the live API. They rely on the
 * dev/preview server having the comments + feedback routes mounted and a
 * working D1 binding (or the local dev manifest).
 */

test.describe('anonymous comments', () => {
  test('submit a comment and see it appear', async ({ page }) => {
    // Go to a subject, then a lecture viewer.
    await page.goto('/');
    const subjectHref = await page.locator('a[href^="/subject/"]').first().getAttribute('href');
    await page.goto(subjectHref!);
    const lectureHref = await page.locator('a[href^="/view/"]').first().getAttribute('href');
    await page.goto(lectureHref!);

    const section = page.locator('[data-comments]').first();
    await expect(section).toBeVisible();

    const name = section.locator('input[name="displayName"], #comment-name').first();
    const body = section.locator('textarea[name="body"], #comment-body').first();
    await name.fill('Playwright');
    await body.fill('This lecture explanation was crystal clear, thank you!');

    // Submit button (avoid the honeypot field).
    await section.locator('button[type="submit"]').click();

    // The new comment should appear in the list.
    await expect(section.locator('text=Playwright').first()).toBeVisible({ timeout: 10_000 });
  });

  test('rejects a comment containing profanity', async ({ page }) => {
    await page.goto('/');
    const subjectHref = await page.locator('a[href^="/subject/"]').first().getAttribute('href');
    await page.goto(subjectHref!);
    const lectureHref = await page.locator('a[href^="/view/"]').first().getAttribute('href');
    await page.goto(lectureHref!);

    const section = page.locator('[data-comments]').first();
    await section.locator('input[name="displayName"], #comment-name').first().fill('Tester');
    await section.locator('textarea[name="body"], #comment-body').first().fill('you ass');

    await section.locator('button[type="submit"]').click();
    // An error / status region should indicate rejection (kept generic).
    await expect(section.locator('[role="alert"], [data-status]').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('usefulness feedback', () => {
  test('vote "useful" and see the count update', async ({ page }) => {
    await page.goto('/');
    const subjectHref = await page.locator('a[href^="/subject/"]').first().getAttribute('href');
    await page.goto(subjectHref!);
    const lectureHref = await page.locator('a[href^="/view/"]').first().getAttribute('href');
    await page.goto(lectureHref!);

    const widget = page.locator('[data-feedback]').first();
    await expect(widget).toBeVisible();
    await widget.getByRole('button', { name: /useful/i }).click();
    // After voting, a helpful count should be shown.
    await expect(widget.locator('text=/\\d+/').first()).toBeVisible({ timeout: 10_000 });
  });
});
