import type { Vec2 } from '../model/types';

/** Maps plan millimetres to CSS pixels. */
export class Viewport {
  /** World point at the centre of the canvas. */
  cx = 2500;
  cy = 2000;
  /** CSS pixels per millimetre. */
  scale = 0.12;
  width = 800;
  height = 600;

  static readonly MIN_SCALE = 0.005;
  static readonly MAX_SCALE = 3;

  toScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.cx) * this.scale + this.width / 2,
      y: (p.y - this.cy) * this.scale + this.height / 2,
    };
  }

  toWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.width / 2) / this.scale + this.cx,
      y: (p.y - this.height / 2) / this.scale + this.cy,
    };
  }

  /** Zooms by `factor` keeping the world point under `screen` fixed. */
  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toWorld(screen);
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const after = this.toWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.scale;
    this.cy -= dyScreen / this.scale;
  }

  /** Fits a world-space box with margins in pixels (top/bottom leave room for overlays). */
  fit(
    box: { minX: number; minY: number; maxX: number; maxY: number },
    margin = 60,
    top = margin,
    bottom = margin,
  ): void {
    const w = Math.max(box.maxX - box.minX, 1000);
    const h = Math.max(box.maxY - box.minY, 1000);
    const availW = Math.max(50, this.width - margin * 2);
    const availH = Math.max(50, this.height - top - bottom);
    const s = Math.min(availW / w, availH / h);
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, s));
    this.cx = (box.minX + box.maxX) / 2;
    // shift so the box is centred in the area between the top and bottom margins
    this.cy = (box.minY + box.maxY) / 2 - (top - bottom) / 2 / this.scale;
  }

  visibleWorld(): { minX: number; minY: number; maxX: number; maxY: number } {
    const a = this.toWorld({ x: 0, y: 0 });
    const b = this.toWorld({ x: this.width, y: this.height });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
