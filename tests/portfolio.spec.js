const { test, expect } = require('@playwright/test');

test.describe('Portfolio Website', () => {
    test('should load homepage successfully', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toContainText('Alejandro Figueroa');
        await expect(page.locator('.tagline')).toContainText('Autonomous Systems');
    });

    test('should have working mailing list form', async ({ page }) => {
        await page.goto('/');

        const emailInput = page.locator('#emailInput');
        const submitButton = page.locator('#subscribeBtn');

        await emailInput.fill('test@example.com');
        await submitButton.click();

        await expect(page.locator('.form-message')).toBeVisible();
    });

    test('should show project previews on hover (desktop)', async ({ page }) => {
        await page.goto('/');

        const projectLink = page.locator('.project-links a.demo').first();
        await projectLink.hover();

        await expect(page.locator('.link-preview')).toBeVisible();
    });

    test('should be responsive on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');

        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('.projects')).toBeVisible();

        // Tooltips should be hidden on mobile
        const tooltip = page.locator('.link-preview');
        await expect(tooltip).toHaveCSS('display', 'none');
    });

    test('should have good performance metrics', async ({ page }) => {
        await page.goto('/');

        const performanceEntries = await page.evaluate(() => {
            return JSON.stringify(performance.getEntriesByType('navigation'));
        });

        const entries = JSON.parse(performanceEntries);
        const [entry] = entries;

        // First Contentful Paint should be under 2 seconds
        expect(entry.loadEventEnd - entry.fetchStart).toBeLessThan(2000);
    });
});
