import { test, expect, openScreenshotMode } from './fixtures';

test('boots with WebGL2 and renders the 3D canvas', async ({ page }, info) => {
  await openScreenshotMode(page);
  const glInfo = await page.evaluate(() => window.__mrInfo);
  expect(glInfo?.webgl2).toBe(true);
  // Canvas must not be blank: sample pixels via toDataURL (preserveDrawingBuffer in screenshot mode).
  const distinct = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#view')!;
    const img = document.createElement('canvas');
    img.width = 64;
    img.height = 64;
    const ctx = img.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return set.size;
  });
  expect(distinct).toBeGreaterThan(5);
  await page.screenshot({ path: `screenshots/step0-hello-${info.project.name}.png` });
});

test('PWA manifest and service worker are served', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  expect((await res.json()).name).toBe('Modulo: Room');
  await page.goto('/');
  const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(swReady).toBe(true);
});
