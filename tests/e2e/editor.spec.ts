import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect, openScreenshotMode } from './fixtures';

/** Page coordinates of a world point (mm). */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
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

const model = (page: Page) =>
  page.evaluate(() => {
    const s = window.__mr!.store;
    const lv = s.level;
    return {
      walls: Object.keys(lv.walls).length,
      openings: Object.values(lv.openings),
      items: Object.values(lv.items),
      rooms: s.derived.rooms.map((r) => ({ id: r.id, name: r.meta?.name, area: Math.round(r.area) })),
      selection: s.selection,
      scale: window.__mr!.app.editor.vp.scale,
    };
  });

async function tap(page: Page, p: { x: number; y: number }, touch: boolean): Promise<void> {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Draws a 4.00 × 3.00 m room with the room tool and typed dimensions. */
async function drawRoom(page: Page, touch: boolean): Promise<void> {
  await page.locator('[data-tool="room"]').click();
  await tap(page, await at(page, 0, 0), touch);
  await page.getByRole('button', { name: 'Type size' }).click();
  const form = page.locator('form.numeric');
  await form.locator('input[name="w"]').fill('4');
  await form.locator('input[name="h"]').fill('300 cm');
  await form.locator('input[name="w"]').press('Enter');
  await expect(form).toHaveCount(0);
}

test('draws a 4.00 × 3.00 m room with exact typed dimensions', async ({ page }, info) => {
  await openScreenshotMode(page);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await drawRoom(page, info.project.name === 'ipad');
  const m = await model(page);
  expect(m.walls).toBe(4);
  expect(m.rooms).toHaveLength(1);
  expect(m.rooms[0]!.area).toBe(12_000_000);
  await expect(page.locator('.room-list')).toContainText('12.00 m²');
  await page.screenshot({ path: `screenshots/p1-room-${info.project.name}.png` });
});

test('draws walls with typed length and angle, then closes the room', async ({ page }) => {
  await openScreenshotMode(page);
  await page.keyboard.press('w');
  await page.mouse.click((await at(page, 0, 0)).x, (await at(page, 0, 0)).y);
  const form = page.locator('form.numeric');
  for (const [len, ang] of [
    ['3.5', '0'],
    ['2.8', '-90'],
    ['3.5', '180'],
  ]) {
    await page.keyboard.type(len!.slice(0, 1)); // typing a digit opens the length field
    await form.locator('input[name="length"]').fill(len!);
    await form.locator('input[name="angle"]').fill(ang!);
    await form.locator('input[name="angle"]').press('Enter');
    await expect(form).toHaveCount(0);
  }
  // click back on the start point to close the loop
  const start = await at(page, 0, 0);
  await page.mouse.click(start.x, start.y);
  const m = await model(page);
  expect(m.walls).toBe(4);
  expect(m.rooms).toHaveLength(1);
  // centreline 3.5 × 2.8 with 150 mm walls -> interior 3.35 × 2.65
  expect(m.rooms[0]!.area).toBe(Math.round(3350 * 2650));
});

test('adds a door and a window on walls, furniture from the catalog, and edits sizes', async ({
  page,
}, info) => {
  const touch = info.project.name === 'ipad';
  await openScreenshotMode(page);
  await drawRoom(page, touch);
  // door on the bottom wall, window on the top wall (interior faces at y=3000 and y=0)
  await page.locator('[data-tool="door"]').click();
  await tap(page, await at(page, 1200, 3000 + 75), touch);
  await page.locator('[data-tool="window"]').click();
  await tap(page, await at(page, 2000, -75), touch);
  let m = await model(page);
  expect(m.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
  // furniture
  await page.locator('[data-tool="furniture"]').click();
  await page.locator('[data-catalog-id="bed-double"]').click();
  await tap(page, await at(page, 2000, 1500), touch);
  m = await model(page);
  expect(m.items).toHaveLength(1);
  expect(m.items[0]!.catalogId).toBe('bed-double');
  expect(m.selection[0]?.coll).toBe('items');
  // edit width through the inspector
  const w = page.getByTestId('item-width');
  await w.fill('1.4');
  await w.press('Enter');
  m = await model(page);
  expect(m.items[0]!.width).toBe(1400);
  await page.screenshot({ path: `screenshots/p1-furnished-${info.project.name}.png` });
  // undo / redo
  await page.locator('.topbar [aria-label="Undo"]').click();
  expect((await model(page)).items[0]!.width).toBe(1650);
  await page.locator('.topbar [aria-label="Redo"]').click();
  expect((await model(page)).items[0]!.width).toBe(1400);
});

test('clicking an interior dimension sets the exact room size', async ({ page }) => {
  await openScreenshotMode(page);
  await drawRoom(page, false);
  await page.keyboard.press('Escape');
  // top interior edge label sits just inside the top wall
  const label = await page.evaluate(() => {
    const ed = window.__mr!.app.editor;
    const hot = (
      ed as unknown as { hot: { kind: string; center: { x: number; y: number }; value: number }[] }
    ).hot;
    const h = hot.find((x) => x.kind === 'roomEdge' && Math.abs(x.value - 4000) < 1);
    const r = ed.canvas.getBoundingClientRect();
    const s = ed.vp.toScreen(h!.center);
    return { x: r.left + s.x, y: r.top + s.y };
  });
  await page.mouse.click(label.x, label.y);
  const form = page.locator('form.numeric');
  await expect(form).toBeVisible();
  await form.locator('input[name="len"]').fill('5 m');
  await form.locator('input[name="len"]').press('Enter');
  const m = await model(page);
  expect(m.rooms[0]!.area).toBe(15_000_000);
});

test('units toggle switches every label to feet and inches', async ({ page }) => {
  await openScreenshotMode(page);
  await drawRoom(page, false);
  await page.locator('.topbar').getByRole('radio', { name: 'ft-in' }).click();
  await expect(page.locator('.room-list')).toContainText('ft²');
  await page.locator('.topbar').getByRole('radio', { name: 'm', exact: true }).click();
  await expect(page.locator('.room-list')).toContainText('m²');
});

test('saves a project file and opens it again (round trip)', async ({ page }) => {
  await openScreenshotMode(page, '/?sample=1');
  const before = await page.evaluate(() => JSON.stringify(window.__mr!.store.committed.levels));
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await (await dl).path();
  const text = readFileSync(file, 'utf8');
  expect(JSON.parse(text).format).toBe('modulo-room');
  // wipe, then open the file again
  await page.evaluate(() =>
    window.__mr!.store.load(
      window.__mr!.store.committed && {
        ...window.__mr!.store.committed,
        levels: [
          {
            ...window.__mr!.store.committed.levels[0]!,
            walls: {},
            nodes: {},
            openings: {},
            items: {},
            rooms: {},
          },
        ],
      },
    ),
  );
  expect((await model(page)).walls).toBe(0);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(file);
  await expect.poll(async () => (await model(page)).walls).toBeGreaterThan(0);
  const after = await page.evaluate(() => JSON.stringify(window.__mr!.store.committed.levels));
  expect(after).toBe(before);
});

test('sample flat renders cleanly with zero warnings', async ({ page }, info) => {
  await openScreenshotMode(page, '/?sample=1');
  const m = await model(page);
  expect(m.rooms.map((r) => r.name).sort()).toEqual(['Bathroom', 'Bedroom', 'Living room']);
  await expect(page.locator('.statusbar')).not.toContainText('check');
  await page.screenshot({ path: `screenshots/p1-sample-${info.project.name}.png` });
});

test('touch: pinch zooms, long-press opens the context menu, palm is ignored while the pencil draws', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'ipad', 'touch profile only');
  await openScreenshotMode(page, '/?sample=1');
  const cdp = await page.context().newCDPSession(page);
  const c = await at(page, 3500, 2500);
  const scale0 = (await model(page)).scale;
  const pts = (d: number) => [
    { x: c.x - d, y: c.y, id: 1 },
    { x: c.x + d, y: c.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
  for (const d of [60, 90, 120])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const scale1 = (await model(page)).scale;
  expect(scale1).toBeGreaterThan(scale0 * 2);
  await page.locator('.zoom-ctl [aria-label="Zoom to fit"]').click();
  // long-press on the bed
  const bed = await at(page, 5525, 1200);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bed.x, y: bed.y, id: 3 }],
  });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu')).toContainText('Rotate 90°');
  await page.screenshot({ path: `screenshots/p1-context-menu-ipad.png` });
  await page.locator('.ctx-menu').getByText('Rotate 90°').click();
  const bedItem = (await model(page)).items.find((i) => i.catalogId === 'bed-double');
  expect(bedItem!.rotation).toBe(90);
});

test('keyboard: tool shortcuts, delete and help overlay', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop profile only');
  await openScreenshotMode(page, '/?sample=1');
  const sofa = await at(page, 1650, 3300);
  await page.mouse.click(sofa.x, sofa.y);
  expect((await model(page)).selection[0]?.coll).toBe('items');
  const n = (await model(page)).items.length;
  await page.keyboard.press('Delete');
  expect((await model(page)).items.length).toBe(n - 1);
  await page.keyboard.press('Control+z');
  expect((await model(page)).items.length).toBe(n);
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog')).toContainText('Keyboard shortcuts');
  await page.screenshot({ path: 'screenshots/p1-shortcuts-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
