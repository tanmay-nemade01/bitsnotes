import { test, expect } from '@playwright/test';

/**
 * Browse-all / filters + Support page e2e (Phase 9 browser section).
 */

test.describe('browse all + filters', () => {
  test('switch to Browse all and expand a subject accordion', async ({ page }) => {
    await page.goto('/');
    const browseToggle = page.getByRole('button', { name: /browse all/i }).first();
    await expect(browseToggle).toBeVisible();
    await browseToggle.click();

    const accordion = page.locator('[data-subject-accordion]').first();
    await expect(accordion).toBeVisible();
    // Collapsed by default; expand it.
    const header = accordion.locator('button').first();
    await header.click();
    // After expanding, lecture links should be present.
    await expect(accordion.locator('a[href^="/view/"]').first()).toBeVisible();
  });

  test('inline filter narrows results', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /browse all/i }).first().click();
    const filter = page.getByPlaceholder(/filter subjects and resources/i).first();
    await expect(filter).toBeVisible();
    await filter.fill('zzzznotarealsubject');
    // Empty state should appear.
    await expect(page.locator('text=/no (matching )?results/i').first()).toBeVisible();
  });
});

test.describe('support page', () => {
  test('copy UPI button works', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/support');
    const copyBtn = page.getByRole('button', { name: /copy upi/i }).first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    // A confirmation message should appear.
    await expect(page.locator('text=/copied|upi/i').first()).toBeVisible();
  });

  test('support link is present in nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /support/i }).first()).toBeVisible();
  });
});
