import type { Vec2 } from '../model/types';
import type { Viewport } from './viewport';

export interface Style {
  fill?: string | undefined;
  stroke?: string | undefined;
  /** Stroke width in screen pixels (non-scaling). */
  width?: number;
  dash?: number[];
  alpha?: number;
}

export interface TextStyle {
  /** Font size in screen pixels. */
  size: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  bold?: boolean;
  /** Rotation in radians around the anchor. */
  rotation?: number;
  /** Background "halo" colour for legibility. */
  halo?: string;
}

/**
 * Drawing surface in world (mm) coordinates. The same plan code draws to the
 * screen canvas and to SVG for export.
 */
export interface Painter {
  /** Screen pixels per world mm (for converting pixel sizes). */
  readonly pxPerMm: number;
  poly(pts: readonly Vec2[], style: Style, closed?: boolean): void;
  polyHoles(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], style: Style): void;
  /** Union of many polygons filled as ONE path (no antialiasing seams between neighbours). */
  union(polys: readonly (readonly Vec2[])[], style: Style): void;
  line(a: Vec2, b: Vec2, style: Style): void;
  /** Circle of world radius. */
  circle(c: Vec2, r: number, style: Style): void;
  /** Circle of screen-pixel radius (handles, markers). */
  dot(c: Vec2, rPx: number, style: Style): void;
  arc(c: Vec2, r: number, a0: number, a1: number, style: Style): void;
  text(p: Vec2, s: string, style: TextStyle): void;
  image(
    img: CanvasImageSource,
    center: Vec2,
    wMm: number,
    hMm: number,
    rotationRad: number,
    alpha: number,
  ): void;
}

/** Same winding for every ring, so a nonzero fill is their union. */
function orientCW(pts: readonly Vec2[]): readonly Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Vec2;
    const q = pts[(i + 1) % pts.length] as Vec2;
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...pts].reverse() : pts;
}

const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

export class CanvasPainter implements Painter {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private vp: Viewport,
  ) {}

  get pxPerMm(): number {
    return this.vp.scale;
  }

  private path(pts: readonly Vec2[], closed: boolean): void {
    const c = this.ctx;
    pts.forEach((p, i) => {
      const s = this.vp.toScreen(p);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    if (closed) c.closePath();
  }

  private paint(style: Style): void {
    const c = this.ctx;
    c.globalAlpha = style.alpha ?? 1;
    if (style.fill) {
      c.fillStyle = style.fill;
      c.fill('evenodd');
    }
    if (style.stroke) {
      c.strokeStyle = style.stroke;
      c.lineWidth = style.width ?? 1;
      c.setLineDash(style.dash ?? []);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.setLineDash([]);
  }

  poly(pts: readonly Vec2[], style: Style, closed = true): void {
    if (pts.length < 2) return;
    this.ctx.beginPath();
    this.path(pts, closed);
    this.paint(style);
  }

  polyHoles(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], style: Style): void {
    this.ctx.beginPath();
    this.path(outer, true);
    for (const h of holes) this.path(h, true);
    this.paint(style);
  }

  union(polys: readonly (readonly Vec2[])[], style: Style): void {
    const c = this.ctx;
    c.beginPath();
    for (const pts of polys) this.path(orientCW(pts), true);
    c.globalAlpha = style.alpha ?? 1;
    if (style.fill) {
      c.fillStyle = style.fill;
      c.fill('nonzero');
    }
    if (style.stroke) {
      c.strokeStyle = style.stroke;
      c.lineWidth = style.width ?? 1;
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  line(a: Vec2, b: Vec2, style: Style): void {
    this.poly([a, b], style, false);
  }

  circle(c: Vec2, r: number, style: Style): void {
    const s = this.vp.toScreen(c);
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, Math.max(0.5, r * this.vp.scale), 0, Math.PI * 2);
    this.paint(style);
  }

  dot(c: Vec2, rPx: number, style: Style): void {
    const s = this.vp.toScreen(c);
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
    this.paint(style);
  }

  arc(c: Vec2, r: number, a0: number, a1: number, style: Style): void {
    const s = this.vp.toScreen(c);
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, r * this.vp.scale, a0, a1, a1 < a0);
    this.paint(style);
  }

  text(p: Vec2, str: string, st: TextStyle): void {
    const c = this.ctx;
    const s = this.vp.toScreen(p);
    c.save();
    c.translate(s.x, s.y);
    if (st.rotation) c.rotate(st.rotation);
    c.font = `${st.bold ? '600 ' : ''}${st.size}px ${FONT}`;
    c.textAlign = st.align ?? 'center';
    c.textBaseline = st.baseline ?? 'middle';
    if (st.halo) {
      c.lineJoin = 'round';
      c.lineWidth = 3;
      c.strokeStyle = st.halo;
      c.strokeText(str, 0, 0);
    }
    c.fillStyle = st.color;
    c.fillText(str, 0, 0);
    c.restore();
  }

  image(img: CanvasImageSource, center: Vec2, wMm: number, hMm: number, rot: number, alpha: number): void {
    const c = this.ctx;
    const s = this.vp.toScreen(center);
    c.save();
    c.globalAlpha = alpha;
    c.translate(s.x, s.y);
    c.rotate(rot);
    const w = wMm * this.vp.scale;
    const h = hMm * this.vp.scale;
    c.drawImage(img, -w / 2, -h / 2, w, h);
    c.restore();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const n = (v: number) => Number(v.toFixed(2));

/** Writes SVG elements in world mm. `pxPerMm` converts pixel-specified sizes. */
export class SvgPainter implements Painter {
  readonly parts: string[] = [];
  constructor(readonly pxPerMm: number) {}

  private attrs(style: Style): string {
    const k = 1 / this.pxPerMm;
    const a: string[] = [];
    a.push(`fill="${style.fill ?? 'none'}"`);
    if (style.stroke) {
      a.push(`stroke="${style.stroke}" stroke-width="${n((style.width ?? 1) * k)}" stroke-linejoin="round"`);
      if (style.dash?.length) a.push(`stroke-dasharray="${style.dash.map((d) => n(d * k)).join(' ')}"`);
    }
    if (style.alpha !== undefined && style.alpha < 1) a.push(`opacity="${style.alpha}"`);
    a.push('fill-rule="evenodd"');
    return a.join(' ');
  }

  private d(pts: readonly Vec2[], closed: boolean): string {
    return pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('') + (closed ? 'Z' : '');
  }

  poly(pts: readonly Vec2[], style: Style, closed = true): void {
    if (pts.length < 2) return;
    this.parts.push(`<path d="${this.d(pts, closed)}" ${this.attrs(style)}/>`);
  }

  polyHoles(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], style: Style): void {
    const d = [outer, ...holes].map((r) => this.d(r, true)).join('');
    this.parts.push(`<path d="${d}" ${this.attrs(style)}/>`);
  }

  union(polys: readonly (readonly Vec2[])[], style: Style): void {
    const d = polys.map((r) => this.d(orientCW(r), true)).join('');
    this.parts.push(
      `<path d="${d}" ${this.attrs(style).replace('fill-rule="evenodd"', 'fill-rule="nonzero"')}/>`,
    );
  }

  line(a: Vec2, b: Vec2, style: Style): void {
    this.poly([a, b], style, false);
  }

  circle(c: Vec2, r: number, style: Style): void {
    this.parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" ${this.attrs(style)}/>`);
  }

  dot(c: Vec2, rPx: number, style: Style): void {
    this.circle(c, rPx / this.pxPerMm, style);
  }

  arc(c: Vec2, r: number, a0: number, a1: number, style: Style): void {
    const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
    const p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    this.parts.push(
      `<path d="M${n(p0.x)} ${n(p0.y)}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(p1.x)} ${n(p1.y)}" ${this.attrs(style)}/>`,
    );
  }

  text(p: Vec2, s: string, st: TextStyle): void {
    const size = st.size / this.pxPerMm;
    const anchor = st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : 'middle';
    const base = st.baseline === 'top' ? 'hanging' : st.baseline === 'bottom' ? 'auto' : 'central';
    const rot = st.rotation
      ? ` transform="rotate(${n((st.rotation * 180) / Math.PI)} ${n(p.x)} ${n(p.y)})"`
      : '';
    const halo = st.halo
      ? ` stroke="${st.halo}" stroke-width="${n(3 / this.pxPerMm)}" paint-order="stroke" stroke-linejoin="round"`
      : '';
    this.parts.push(
      `<text x="${n(p.x)}" y="${n(p.y)}" font-family="${esc(FONT)}" font-size="${n(size)}" fill="${st.color}" text-anchor="${anchor}" dominant-baseline="${base}"${st.bold ? ' font-weight="600"' : ''}${halo}${rot}>${esc(s)}</text>`,
    );
  }

  image(): void {
    // Reference images are intentionally not exported (they may be private photos).
  }

  toSvg(box: { minX: number; minY: number; maxX: number; maxY: number }, title: string): string {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.minX)} ${n(box.minY)} ${n(w)} ${n(h)}" width="${n(w / 10)}mm" height="${n(h / 10)}mm">`,
      `<title>${esc(title)}</title>`,
      `<rect x="${n(box.minX)}" y="${n(box.minY)}" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`,
      ...this.parts,
      '</svg>',
    ].join('\n');
  }
}
