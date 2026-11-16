import { test as base, expect } from '@playwright/test';

/** Every test fails on console errors or uncaught page errors. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openScreenshotMode(page: import('@playwright/test').Page, path = '/'): Promise<void> {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}screenshot=1`);
  await page.waitForFunction(() => window.__mrReady === true);
}
