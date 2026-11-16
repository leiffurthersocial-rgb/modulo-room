import type { Page } from '@playwright/test';
import { test, expect, openScreenshotMode } from './fixtures';

async function at(page: Page, x: number, y: number) {
  return page.evaluate(
    ([wx, wy]) => {
      const ed = window.__mr!.app.editor;
      const r = ed.canvas.getBoundingClientRect();
      const s = ed.vp.toScreen({ x: wx!, y: wy! });
      return { x: r.left + s.x, y: r.top + s.y };
    },
    [x, y],
  );
}
const click = async (page: Page, x: number, y: number) => {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
};

test('reference image: import locally and calibrate the scale with two points', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop profile only');
  await openScreenshotMode(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Trace a plan or photo' }).click();
  await (await chooser).setFiles('public/icon-512.png');
  await expect.poll(() => page.evaluate(() => window.__mr!.store.tool)).toBe('calibrate');
  const im0 = await page.evaluate(() => Object.values(window.__mr!.store.level.refImages)[0]!);
  // two points 1000 mm apart in current (uncalibrated) plan units
  await click(page, im0.x - 500, im0.y);
  await click(page, im0.x + 500, im0.y);
  const form = page.locator('form.numeric');
  await form.locator('input[name="d"]').fill('2.5 m');
  await form.locator('input[name="d"]').press('Enter');
  const im1 = await page.evaluate(() => Object.values(window.__mr!.store.level.refImages)[0]!);
  expect(im1.mmPerPx / im0.mmPerPx).toBeCloseTo(2.5, 2);
  expect(await page.evaluate(() => window.__mr!.store.tool)).toBe('select');
  await page.screenshot({ path: 'screenshots/p1-reference-desktop.png' });
});

test('measure, text label and erase tools', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop profile only');
  await openScreenshotMode(page, '/?sample=1');
  await page.keyboard.press('m');
  await click(page, 0, 5000);
  await click(page, 4150, 5000);
  let ann = await page.evaluate(() => Object.values(window.__mr!.store.level.annotations));
  expect(ann).toHaveLength(1);
  expect(ann[0]!.kind).toBe('dimension');
  await page.keyboard.press('t');
  await click(page, 2000, 4700);
  await page.locator('form.numeric input[name="t"]').fill('Entrance');
  await page.locator('form.numeric input[name="t"]').press('Enter');
  ann = await page.evaluate(() => Object.values(window.__mr!.store.level.annotations));
  expect(ann.map((a) => (a.kind === 'text' ? a.text : 'dim')).sort()).toEqual(['Entrance', 'dim']);
  const n = await page.evaluate(() => Object.keys(window.__mr!.store.level.items).length);
  await page.keyboard.press('x');
  await click(page, 1650, 2250); // coffee table
  expect(await page.evaluate(() => Object.keys(window.__mr!.store.level.items).length)).toBe(n - 1);
});

test('autosaves to this device and restores after reload', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__mrReady === true);
  await page.evaluate(() => {
    const s = window.__mr!.store;
    s.dispatch({
      type: 'addRectRoom',
      level: s.levelId,
      x: 0,
      y: 0,
      w: 3000,
      h: 3000,
      thickness: 150,
      height: 2500,
    });
  });
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device', { timeout: 5000 });
  await page.reload();
  await page.waitForFunction(() => window.__mrReady === true);
  const area = await page.evaluate(() => window.__mr!.store.derived.rooms[0]?.area);
  expect(Math.round(area ?? 0)).toBe(9_000_000);
});

test('furniture tab: filter plants, drag a plant onto the plan, recently used appears', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'HTML5 drag-and-drop is a mouse interaction');
  await openScreenshotMode(page, '/?sample=1');
  await page.getByTestId('tab-furniture').click();
  await page.getByRole('tab', { name: /Plants/ }).click();
  const cards = page.locator('.catalog-grid [data-catalog-id^="plant-"]');
  expect(await cards.count()).toBeGreaterThanOrEqual(10);
  const n = await page.evaluate(() => Object.keys(window.__mr!.store.level.items).length);
  const target = await at(page, 2000, 1200);
  await page.locator('[data-catalog-id="plant-monstera"]').dragTo(page.locator('canvas.plan-canvas'), {
    targetPosition: await page.evaluate(
      ([x, y]) => {
        const r = window.__mr!.app.editor.canvas.getBoundingClientRect();
        return { x: x! - r.left, y: y! - r.top };
      },
      [target.x, target.y],
    ),
  });
  const items = await page.evaluate(() => Object.values(window.__mr!.store.level.items));
  expect(items.length).toBe(n + 1);
  const placed = items.find((i) => i.catalogId === 'plant-monstera')!;
  expect(Math.abs(placed.x - 2000)).toBeLessThan(20);
  await page.getByTestId('tab-furniture').click();
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(page.locator('.catalog h3').first()).toHaveText(/Recently used/);
  // inside a category only that category's items show — no "Recently used" row
  await page.getByRole('tab', { name: /^Beds/ }).click();
  await expect(page.locator('.catalog h3', { hasText: 'Recently used' })).toHaveCount(0);
  await expect(page.locator('.catalog-grid [data-catalog-id="plant-monstera"]')).toHaveCount(0);
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.screenshot({ path: 'screenshots/p1-catalog-plants-desktop.png' });
});
