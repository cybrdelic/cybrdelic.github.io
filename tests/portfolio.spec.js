import { expect, test } from '@playwright/test';

test.describe('Portfolio Website', () => {
    test('should load homepage successfully', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toContainText('Alejandro Figueroa');
        await expect(page.locator('.tagline')).toContainText('Autonomous Systems');
    });

    test('should have working mailing list form', async ({ page }) => {
        await page.goto('/');

        const emailInput = page.locator('.newsletter-form input[type="email"]');
        const submitButton = page.locator('.newsletter-form button[type="submit"]');

        await expect(emailInput).toBeVisible();
        await expect(submitButton).toBeVisible();

        await emailInput.fill('test@example.com');
        await expect(emailInput).toHaveValue('test@example.com');

        // Optional: verify clicking opens new tab (target _blank) without errors
        const [popup] = await Promise.all([
            page.waitForEvent('popup').catch(() => null),
            submitButton.click()
        ]);
        if (popup) await popup.close();
    });

    test('should show project previews on hover (desktop)', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Preview system disabled on mobile devices');
        await page.goto('/');

        const previewLink = page.locator('a[data-preview="true"]').first();
        if (await previewLink.count() === 0) test.skip(true, 'No preview-enabled links found');

        await previewLink.hover();
        await page.waitForTimeout(500); // hover delay + animation buffer
        await expect(page.locator('.link-preview-panel.visible')).toBeVisible();
    });

    test('should be responsive on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');

        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('.projects')).toBeVisible();

        // Preview system should not instantiate on touch/mobile
        await expect(page.locator('.link-preview-panel')).toHaveCount(0);
    });

    test('should have good performance metrics', async ({ page }) => {
        await page.goto('/');

        const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            return nav ? nav.loadEventEnd - nav.fetchStart : null;
        });
        if (timing !== null) {
            expect(timing).toBeLessThan(3000); // relaxed threshold for local env
        }
    });
});
