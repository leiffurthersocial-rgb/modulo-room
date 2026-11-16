import { test, expect, openScreenshotMode } from './fixtures';

test('boots into the editor with a drawn plan canvas', async ({ page }) => {
  await openScreenshotMode(page, '/?sample=1');
  await expect(page.locator('canvas.plan-canvas')).toBeVisible();
  const distinct = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.plan-canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return set.size;
  });
  expect(distinct).toBeGreaterThan(20);
});

test('PWA manifest and service worker are served', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect((await res.json()).name).toBe('Modulo: Room');
  await page.goto('/');
  const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
  expect(swReady).toBe(true);
});

test('pen draws a wall while a resting palm touch is ignored', async ({ page }, info) => {
  test.skip(info.project.name !== 'ipad', 'touch profile only');
  await openScreenshotMode(page);
  await page.keyboard.press('w');
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) =>
    page.evaluate(
      ([wx, wy]) => {
        const ed = window.__mr!.app.editor;
        const r = ed.canvas.getBoundingClientRect();
        const s = ed.vp.toScreen({ x: wx!, y: wy! });
        return { x: r.left + s.x, y: r.top + s.y };
      },
      [x, y],
    );
  const pen = async (x: number, y: number) => {
    const p = await pt(x, y);
    for (const type of ['mousePressed', 'mouseReleased'] as const)
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
        pointerType: 'pen',
      });
  };
  await pen(0, 0);
  // palm lands while the pencil is active: must not add a corner
  const palm = await pt(2500, 2500);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: palm.x, y: palm.y, id: 9 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pen(3000, 0);
  await page.keyboard.press('Enter');
  const walls = await page.evaluate(() => Object.keys(window.__mr!.store.level.walls).length);
  expect(walls).toBe(1);
});
