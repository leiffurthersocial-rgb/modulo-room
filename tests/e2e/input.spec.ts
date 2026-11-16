import { test, expect, openScreenshotMode } from './fixtures';

async function planPoint(page: import('@playwright/test').Page, fx: number, fy: number) {
  const box = (await page.locator('#plan').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

test('mouse pointer events reach the 2D plan', async ({ page }) => {
  await openScreenshotMode(page);
  const p = await planPoint(page, 0.3, 0.4);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#ptr')).toHaveAttribute('data-type', 'mouse');
});

test('touch tap produces pointerType=touch', async ({ page }, info) => {
  test.skip(info.project.name !== 'ipad', 'touch profile only');
  await openScreenshotMode(page);
  const p = await planPoint(page, 0.6, 0.5);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.locator('#ptr')).toHaveAttribute('data-type', 'touch');
});

test('two-finger touch delivers two concurrent pointers (pinch/pan groundwork)', async ({ page }, info) => {
  test.skip(info.project.name !== 'ipad', 'touch profile only');
  await openScreenshotMode(page);
  await page.evaluate(() => {
    (window as unknown as { __ids: Set<number> }).__ids = new Set();
    document
      .querySelector('#plan')!
      .addEventListener('pointerdown', (e) =>
        (window as unknown as { __ids: Set<number> }).__ids.add((e as PointerEvent).pointerId),
      );
  });
  const a = await planPoint(page, 0.3, 0.5);
  const b = await planPoint(page, 0.7, 0.5);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: a.x, y: a.y, id: 1 },
      { x: b.x, y: b.y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const n = await page.evaluate(() => (window as unknown as { __ids: Set<number> }).__ids.size);
  expect(n).toBe(2);
});

test('pen input (Apple Pencil stand-in) produces pointerType=pen', async ({ page }) => {
  await openScreenshotMode(page);
  const p = await planPoint(page, 0.5, 0.3);
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      clickCount: 1,
      pointerType: 'pen',
      force: 0.5,
    });
  }
  await expect(page.locator('#ptr')).toHaveAttribute('data-type', 'pen');
});
