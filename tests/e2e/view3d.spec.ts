import type { Page } from '@playwright/test';
import { test, expect, openScreenshotMode } from './fixtures';

declare global {
  interface Window {
    __mr3d?: {
      frames: number;
      cameraMode: string;
      wallMode: string;
      stats(): { walls: number; items: number; meshes: number; calls: number; cut: number };
      step(forward: number, strafe: number): void;
      walkerPosition: { x: number; y: number };
    };
  }
}

async function wait3d(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__mr3d?.frames ?? 0) > 1, null, { timeout: 30_000 });
}

async function nonBlank(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.view3d-canvas')!;
    const tmp = document.createElement('canvas');
    tmp.width = 96;
    tmp.height = 64;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 96, 64);
    const d = ctx.getImageData(0, 0, 96, 64).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4)
      set.add(((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3));
    return set.size;
  });
}

test('split view shows the greybox 3D model of the plan', async ({ page }, info) => {
  await openScreenshotMode(page, '/?sample=1&view=split');
  await wait3d(page);
  const st = await page.evaluate(() => window.__mr3d!.stats());
  const model = await page.evaluate(() => ({
    walls: Object.keys(window.__mr!.store.level.walls).length,
    items: Object.keys(window.__mr!.store.level.items).length,
  }));
  expect(st.walls).toBe(model.walls);
  expect(st.items).toBe(model.items);
  expect(st.cut).toBeGreaterThan(0); // cutaway lowers the walls facing the camera
  expect(await nonBlank(page)).toBeGreaterThan(40);
  await expect(page.locator('.view-only-badge')).toBeVisible();
  await page.screenshot({ path: `screenshots/p2-split-${info.project.name}.png` });
});

test('3D follows 2D edits live and stays view-only', async ({ page }) => {
  await openScreenshotMode(page, '/?sample=1&view=split');
  await wait3d(page);
  const before = await page.evaluate(() => window.__mr3d!.stats());
  await page.evaluate(() => {
    const s = window.__mr!.store;
    s.dispatch({
      type: 'addRectRoom',
      level: s.levelId,
      x: 8000,
      y: 0,
      w: 3000,
      h: 3000,
      thickness: 150,
      height: 2500,
    });
  });
  await expect.poll(() => page.evaluate(() => window.__mr3d!.stats().walls)).toBe(before.walls + 4);
  // drag-free interaction with the 3D canvas never changes the document
  const rev = await page.evaluate(() => window.__mr!.store.revision);
  const box = (await page.locator('canvas.view3d-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(() => window.__mr!.store.revision)).toBe(rev);
  // undo in 2D removes the room in 3D too
  await page.locator('.topbar [aria-label="Undo"]').click();
  await expect.poll(() => page.evaluate(() => window.__mr3d!.stats().walls)).toBe(before.walls);
});

test('camera modes, dollhouse and walk with wall collision', async ({ page }, info) => {
  await openScreenshotMode(page, '/?sample=1&view=3d');
  await wait3d(page);
  for (const cam of ['top', 'iso', 'orbit']) {
    await page.locator(`[data-camera="${cam}"]`).click();
    await expect.poll(() => page.evaluate(() => window.__mr3d!.cameraMode)).toBe(cam);
  }
  await page.locator('[data-walls="dollhouse"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__mr3d!.stats().cut))
    .toBe(await page.evaluate(() => window.__mr3d!.stats().walls));
  await page.screenshot({ path: `screenshots/p2-dollhouse-${info.project.name}.png` });
  await page.locator('[data-walls="auto"]').click();
  await page.locator('[data-camera="walk"]').click();
  await expect(page.locator('.walk-joystick')).toBeVisible();
  // walk 20 m straight ahead: the walls must stop us inside the flat
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.__mr3d!.step(500, 0));
  const p = await page.evaluate(() => window.__mr3d!.walkerPosition);
  expect(p.x).toBeGreaterThan(-100);
  expect(p.x).toBeLessThan(7100);
  expect(p.y).toBeGreaterThan(-100);
  expect(p.y).toBeLessThan(5100);
  await page.screenshot({ path: `screenshots/p2-walk-${info.project.name}.png` });
});

test('layout shortcuts switch between 2D, split, 3D and picture-in-picture', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard');
  await openScreenshotMode(page, '/?sample=1');
  await expect(page.locator('.pane-3d')).toBeHidden();
  await page.keyboard.press('3');
  await expect(page.locator('.pane-2d')).toBeHidden();
  await wait3d(page);
  await page.keyboard.press('4');
  await expect(page.locator('.pane-3d')).toBeVisible();
  await expect(page.locator('.pane-2d')).toBeVisible();
  await page.screenshot({ path: 'screenshots/p2-pip-desktop.png' });
  await page.keyboard.press('1');
  await expect(page.locator('.pane-3d')).toBeHidden();
});
