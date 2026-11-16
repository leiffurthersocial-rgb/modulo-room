import { catalogEntry } from '../catalog/catalog';
import type { Derived } from '../app/derived';
import { clearanceZone, doorSwing, itemCorners, itemToWorld } from '../geometry/collide';
import { openingFrame, openingRect } from '../geometry/footprints';
import { rightNormal } from '../geometry/rooms';
import { add, dist, leftNormal, mid, norm, scale, sub } from '../geometry/vec';
import { formatArea, formatLength, type UnitPrefs } from '../model/units';
import type { Annotation, Item, Level, Opening, ProjectSettings, Ref, Vec2 } from '../model/types';
import type { Painter } from './painter';

export const THEME = {
  paper: '#f7f6f2',
  gridMinor: '#ebe8e1',
  gridMajor: '#d9d5cb',
  wall: '#2f3237',
  wallHub: '#2f3237',
  roomFills: ['#efe9dd', '#e6ece6', '#e9e6ef', '#efe6e2', '#e3eaee', '#eeeadf'],
  roomLabel: '#3b3f45',
  dim: '#5d6470',
  item: '#ffffff',
  itemStroke: '#4c525b',
  partStroke: '#8a9099',
  accent: '#2f6fec',
  accentSoft: 'rgba(47,111,236,0.14)',
  warn: '#d93a2b',
  warnSoft: 'rgba(217,58,43,0.12)',
  clearance: 'rgba(47,111,236,0.10)',
  text: '#262a30',
};

/** A clickable label (screen space), e.g. a room edge dimension. */
export interface HotLabel {
  kind: 'roomEdge' | 'wallLength';
  roomId?: string;
  edge?: number;
  wallId?: string;
  center: Vec2; // world
  value: number;
  w: number; // px
  h: number; // px
}

export interface RenderOpts {
  settings: ProjectSettings;
  selection: readonly Ref[];
  hover: Ref | null;
  images?: Map<string, CanvasImageSource>;
  hot?: HotLabel[];
  touch?: boolean;
  export?: boolean;
}

const prefsOf = (s: ProjectSettings): UnitPrefs => ({ units: s.units, metricUnit: s.metricUnit });
const isSel = (sel: readonly Ref[], coll: Ref['coll'], id: string) =>
  sel.some((r) => r.coll === coll && r.id === id);

/** Keeps text upright: rotation in (-90°, 90°]. */
function readable(angle: number): number {
  let a = angle;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

export function drawGrid(
  p: Painter,
  s: ProjectSettings,
  view: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const px = p.pxPerMm;
  const steps = [s.gridSize, 500, 1000, 5000, 10000].filter((g) => g * px >= 7);
  const minor = steps[0];
  if (!minor) return;
  const major = minor >= 1000 ? minor * 5 : 1000;
  const lines = (step: number, color: string, width: number) => {
    const x0 = Math.floor(view.minX / step) * step;
    const y0 = Math.floor(view.minY / step) * step;
    for (let x = x0; x <= view.maxX; x += step)
      p.line({ x, y: view.minY }, { x, y: view.maxY }, { stroke: color, width });
    for (let y = y0; y <= view.maxY; y += step)
      p.line({ x: view.minX, y }, { x: view.maxX, y }, { stroke: color, width });
  };
  lines(minor, THEME.gridMinor, 1);
  if (major * px >= 7) lines(major, THEME.gridMajor, 1);
}

function drawRefImages(p: Painter, level: Level, opts: RenderOpts): void {
  if (!opts.images) return;
  for (const r of Object.values(level.refImages)) {
    if (!r.visible) continue;
    const img = opts.images.get(r.blobKey);
    if (!img) continue;
    p.image(img, r, r.widthPx * r.mmPerPx, r.heightPx * r.mmPerPx, (r.rotation * Math.PI) / 180, r.opacity);
    if (isSel(opts.selection, 'refImages', r.id)) {
      const hw = (r.widthPx * r.mmPerPx) / 2;
      const hh = (r.heightPx * r.mmPerPx) / 2;
      const rot = (r.rotation * Math.PI) / 180;
      const corners = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ].map((c) => itemToWorld({ x: r.x, y: r.y, rotation: (rot * 180) / Math.PI }, c));
      p.poly(corners, { stroke: THEME.accent, width: 1.5, dash: [6, 4] });
    }
  }
}

function drawItem(p: Painter, it: Item, opts: RenderOpts, warn: boolean, busy: readonly Vec2[] = []): void {
  const e = catalogEntry(it.catalogId);
  const corners = itemCorners(it);
  const ceiling = e?.mount === 'ceiling';
  const rug = e?.category === 'rug';
  const fill = it.color ?? e?.color ?? '#cccccc';
  p.poly(corners, {
    fill: rug ? fill : THEME.item,
    alpha: rug ? 0.55 : 1,
    stroke: warn ? THEME.warn : THEME.itemStroke,
    width: warn ? 2 : 1.2,
    ...(ceiling ? { dash: [5, 4] } : {}),
  });
  if (!rug && e) {
    // Top view of the primitive parts, highest parts drawn last.
    const parts = [...e.parts].sort((a, b) => a[6] - b[6]);
    for (const part of parts) {
      const [shape, x0, y0, , x1, y1] = part;
      const L = (x: number, y: number) => ({
        x: (x - 0.5) * it.width * (it.mirrored ? -1 : 1),
        y: (y - 0.5) * it.depth,
      });
      if (shape === 'cyl') {
        const c = itemToWorld(it, L((x0 + x1) / 2, (y0 + y1) / 2));
        const r = (Math.min(x1 - x0, y1 - y0) * Math.min(it.width, it.depth)) / 2;
        p.circle(c, r, { fill, alpha: 0.35, stroke: THEME.partStroke, width: 0.8 });
      } else {
        const pts = [L(x0, y0), L(x1, y0), L(x1, y1), L(x0, y1)].map((q) => itemToWorld(it, q));
        p.poly(pts, { fill, alpha: 0.35, stroke: THEME.partStroke, width: 0.8 });
      }
    }
  }
  const sel = isSel(opts.selection, 'items', it.id);
  const hov = opts.hover?.coll === 'items' && opts.hover.id === it.id;
  if (sel || hov) p.poly(corners, { stroke: THEME.accent, width: sel ? 2.5 : 1.5 });
  // Room names win: skip the item label when it would sit on one.
  const nearRoomLabel = busy.some(
    (c) => Math.abs(c.x - it.x) * p.pxPerMm < 70 && Math.abs(c.y - it.y) * p.pxPerMm < 26,
  );
  if (opts.settings.showLabels && !opts.export && !nearRoomLabel) {
    const px = p.pxPerMm;
    const minSide = Math.min(it.width, it.depth) * px;
    if (minSide > 34) {
      const name = it.name ?? e?.name ?? 'Item';
      const rot = readable(((it.rotation + (it.width < it.depth ? 90 : 0)) * Math.PI) / 180);
      const prefs = prefsOf(opts.settings);
      p.text({ x: it.x, y: it.y }, shorten(name, Math.max(it.width, it.depth) * px), {
        size: 11,
        color: THEME.text,
        rotation: rot,
        halo: 'rgba(255,255,255,0.85)',
        baseline: 'bottom',
      });
      p.text({ x: it.x, y: it.y }, `${formatLength(it.width, prefs)} × ${formatLength(it.depth, prefs)}`, {
        size: 10,
        color: THEME.dim,
        rotation: rot,
        halo: 'rgba(255,255,255,0.85)',
        baseline: 'top',
      });
    }
  }
}

function shorten(s: string, maxPx: number): string {
  const maxChars = Math.max(3, Math.floor(maxPx / 6.5));
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

function drawOpening(p: Painter, level: Level, o: Opening, opts: RenderOpts, warn: boolean): void {
  const rect = openingRect(level, o);
  const f = openingFrame(level, o);
  if (!rect || !f) return;
  const t = f.wall.thickness;
  // Gap in the wall
  p.poly(rect, { fill: THEME.paper });
  const [r0, r1, r2, r3] = rect as [Vec2, Vec2, Vec2, Vec2];
  p.line(r0, r3, { stroke: THEME.wall, width: 1.5 });
  p.line(r1, r2, { stroke: THEME.wall, width: 1.5 });
  const sideN = o.side === 'l' ? f.normal : scale(f.normal, -1);
  const along = (k: number) => scale(f.dir, k);
  const ink = { stroke: warn ? THEME.warn : THEME.wall, width: 1.4 };
  switch (o.kind) {
    case 'window':
      p.poly(rect, { stroke: THEME.wall, width: 1 });
      for (const k of [-t / 6, t / 6]) {
        const c = add(f.center, scale(f.normal, k));
        p.line(sub(c, along(o.width / 2)), add(c, along(o.width / 2)), { stroke: THEME.wall, width: 1 });
      }
      break;
    case 'sliding-door': {
      const q = o.width / 2;
      const off = t / 6;
      const a = add(f.center, scale(f.normal, off));
      const b = add(f.center, scale(f.normal, -off));
      p.line(sub(a, along(q)), add(a, along(q * 0.1)), { ...ink, width: 2.5 });
      p.line(sub(b, along(q * 0.1)), add(b, along(q)), { ...ink, width: 2.5 });
      break;
    }
    case 'door':
    case 'double-door': {
      const face = add(f.center, scale(sideN, t / 2));
      const leaves =
        o.kind === 'double-door'
          ? [
              { hinge: sub(face, along(o.width / 2)), closed: f.dir, r: o.width / 2 },
              { hinge: add(face, along(o.width / 2)), closed: scale(f.dir, -1), r: o.width / 2 },
            ]
          : [
              o.hinge === 'a'
                ? { hinge: sub(face, along(o.width / 2)), closed: f.dir, r: o.width }
                : { hinge: add(face, along(o.width / 2)), closed: scale(f.dir, -1), r: o.width },
            ];
      for (const l of leaves) {
        const open = add(l.hinge, scale(sideN, l.r));
        p.line(l.hinge, open, { ...ink, width: 2.2 });
        const a0 = Math.atan2(l.closed.y, l.closed.x);
        const a1 = Math.atan2(sideN.y, sideN.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        p.arc(l.hinge, l.r, a0, a0 + d, { stroke: ink.stroke, width: 0.9, dash: [4, 3] });
      }
      break;
    }
    case 'opening':
      p.line(rect[0] as Vec2, rect[1] as Vec2, { stroke: THEME.wall, width: 0.8, dash: [3, 3] });
      p.line(rect[3] as Vec2, rect[2] as Vec2, { stroke: THEME.wall, width: 0.8, dash: [3, 3] });
      break;
  }
  const sel = isSel(opts.selection, 'openings', o.id);
  const hov = opts.hover?.coll === 'openings' && opts.hover.id === o.id;
  if (sel || hov) p.poly(rect, { stroke: THEME.accent, width: sel ? 2.5 : 1.5, fill: THEME.accentSoft });
}

function drawAnnotation(p: Painter, a: Annotation, opts: RenderOpts): void {
  const sel = isSel(opts.selection, 'annotations', a.id);
  const color = sel ? THEME.accent : THEME.dim;
  if (a.kind === 'text') {
    p.text({ x: a.x, y: a.y }, a.text, {
      size: Math.max(9, a.size * p.pxPerMm),
      color: sel ? THEME.accent : THEME.text,
      halo: THEME.paper,
    });
    return;
  }
  drawDimension(p, a.a, a.b, a.offset, formatLength(dist(a.a, a.b), prefsOf(opts.settings)), color);
}

/** Architectural dimension line with extension lines and tick marks. */
export function drawDimension(
  p: Painter,
  a: Vec2,
  b: Vec2,
  offset: number,
  label: string,
  color = THEME.dim,
): void {
  const d = norm(sub(b, a));
  if (d.x === 0 && d.y === 0) return;
  const nrm = leftNormal(d);
  const a2 = add(a, scale(nrm, offset));
  const b2 = add(b, scale(nrm, offset));
  const ext = 4 / p.pxPerMm;
  const s = Math.sign(offset) || 1;
  p.line(a, add(a2, scale(nrm, ext * s)), { stroke: color, width: 0.8 });
  p.line(b, add(b2, scale(nrm, ext * s)), { stroke: color, width: 0.8 });
  p.line(a2, b2, { stroke: color, width: 1 });
  const tick = scale(norm(add(d, nrm)), 5 / p.pxPerMm);
  p.line(sub(a2, tick), add(a2, tick), { stroke: color, width: 1.6 });
  p.line(sub(b2, tick), add(b2, tick), { stroke: color, width: 1.6 });
  const ang = readable(Math.atan2(d.y, d.x));
  const up = { x: Math.sin(ang), y: -Math.cos(ang) };
  p.text(add(mid(a2, b2), scale(up, 8 / p.pxPerMm)), label, {
    size: 11,
    color,
    rotation: ang,
    halo: THEME.paper,
  });
}

/** Draws the whole level. Order matters: paper > images > grid > rooms > items > walls > labels > selection. */
export function drawPlan(
  p: Painter,
  level: Level,
  d: Derived,
  opts: RenderOpts,
  view: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const s = opts.settings;
  const prefs = prefsOf(s);
  const px = p.pxPerMm;
  if (s.showGrid && !opts.export) drawGrid(p, s, view);
  drawRefImages(p, level, opts);

  // Rooms
  d.rooms.forEach((r, i) => {
    const fill = r.meta?.color ?? THEME.roomFills[i % THEME.roomFills.length];
    p.polyHoles(r.polygon, r.holes, { fill, alpha: 0.9 });
    const sel = isSel(opts.selection, 'rooms', r.id);
    const hov = opts.hover?.coll === 'rooms' && opts.hover.id === r.id;
    if (sel || hov)
      p.polyHoles(r.polygon, r.holes, {
        stroke: THEME.accent,
        width: sel ? 2.5 : 1.2,
        fill: sel ? THEME.accentSoft : undefined,
      });
  });

  const warnItems = new Set<string>();
  const warnOpenings = new Set<string>();
  for (const w of d.warnings) {
    for (const r of w.refs) {
      if (r.coll === 'items') warnItems.add(r.id);
      if (r.coll === 'openings') warnOpenings.add(r.id);
    }
    if (w.area && w.kind === 'door') p.poly(w.area, { fill: THEME.warnSoft });
  }

  // Clearance zones
  if (s.showClearance) {
    for (const it of Object.values(level.items)) {
      const ce = catalogEntry(it.catalogId);
      if (ce?.access)
        p.poly(clearanceZone(it, ce.clearance ?? s.walkwayMin), {
          fill: THEME.clearance,
          stroke: THEME.accent,
          width: 0.8,
          dash: [4, 4],
        });
    }
    for (const o of Object.values(level.openings)) {
      const sw = doorSwing(level, o);
      if (sw) p.poly(sw, { fill: THEME.clearance });
    }
  }

  // Items (floor first, ceiling last)
  const items = Object.values(level.items).sort((a, b) => {
    const ra = catalogEntry(a.catalogId)?.category === 'rug' ? -1 : 0;
    const rb = catalogEntry(b.catalogId)?.category === 'rug' ? -1 : 0;
    return ra - rb || a.elevation - b.elevation || (a.id < b.id ? -1 : 1);
  });
  const roomLabelSpots = s.showLabels ? d.rooms.map((r) => r.center) : [];
  for (const it of items) drawItem(p, it, opts, warnItems.has(it.id), roomLabelSpots);

  // Walls
  p.union([...[...d.footprints.walls.values()].map((f) => f.poly), ...d.footprints.hubs], {
    fill: THEME.wall,
  });
  for (const o of Object.values(level.openings)) drawOpening(p, level, o, opts, warnOpenings.has(o.id));
  for (const w of Object.values(level.walls)) {
    const fp = d.footprints.walls.get(w.id);
    if (!fp) continue;
    const sel = isSel(opts.selection, 'walls', w.id);
    const hov = opts.hover?.coll === 'walls' && opts.hover.id === w.id;
    if (sel || hov)
      p.poly(fp.poly, {
        stroke: THEME.accent,
        width: sel ? 3 : 2,
        fill: sel ? 'rgba(47,111,236,0.35)' : undefined,
      });
  }

  // Room labels and interior dimensions
  for (const r of d.rooms) {
    const areaPx = r.area * px * px;
    if (s.showLabels && areaPx > 2500) {
      const name = r.meta?.name ?? 'Room';
      p.text(r.center, name, {
        size: 13,
        color: THEME.roomLabel,
        bold: true,
        baseline: 'bottom',
        halo: THEME.paper,
      });
      p.text(add(r.center, { x: 0, y: 3 / px }), formatArea(r.area, prefs), {
        size: 11,
        color: THEME.dim,
        baseline: 'top',
        halo: THEME.paper,
      });
    }
    if (!s.showDimensions) continue;
    const n = r.polygon.length;
    for (let k = 0; k < n; k++) {
      const ei = r.edgeIdx[k];
      if (ei === null || ei === undefined) continue;
      const a = r.polygon[k] as Vec2;
      const b = r.polygon[(k + 1) % n] as Vec2;
      const L = dist(a, b);
      if (L * px < 46) continue;
      const dir = norm(sub(b, a));
      const inward = rightNormal(dir);
      const c = add(mid(a, b), scale(inward, 11 / px));
      const label = formatLength(L, prefs);
      p.text(c, label, {
        size: 11,
        color: THEME.dim,
        rotation: readable(Math.atan2(dir.y, dir.x)),
        halo: THEME.paper,
      });
      opts.hot?.push({
        kind: 'roomEdge',
        roomId: r.id,
        edge: k,
        center: c,
        value: L,
        w: label.length * 6.5 + 10,
        h: 18,
      });
    }
  }

  // Wall length on selected walls (centreline), outside the wall
  for (const ref of opts.selection) {
    if (ref.coll !== 'walls') continue;
    const fp = d.footprints.walls.get(ref.id);
    const w = level.walls[ref.id];
    if (!fp || !w) continue;
    const [a, b] = fp.axis;
    const off = w.thickness / 2 + 22 / px;
    drawDimension(p, a, b, off, formatLength(fp.length, prefs), THEME.accent);
    const dir = norm(sub(b, a));
    const c = add(
      add(mid(a, b), scale(leftNormal(dir), off)),
      scale(
        { x: Math.sin(readable(Math.atan2(dir.y, dir.x))), y: -Math.cos(readable(Math.atan2(dir.y, dir.x))) },
        8 / px,
      ),
    );
    opts.hot?.push({ kind: 'wallLength', wallId: w.id, center: c, value: fp.length, w: 70, h: 20 });
  }

  for (const a of Object.values(level.annotations)) drawAnnotation(p, a, opts);

  // Selection handles
  if (!opts.export) drawHandles(p, level, opts);
}

export function handleRadiusPx(touch: boolean | undefined): number {
  return touch ? 9 : 6;
}

/** Rotation handle position for an item (behind its back edge). */
export function rotateHandle(it: Item, pxPerMm: number): Vec2 {
  return itemToWorld(it, { x: 0, y: -it.depth / 2 - 26 / pxPerMm });
}

function drawHandles(p: Painter, level: Level, opts: RenderOpts): void {
  const r = handleRadiusPx(opts.touch);
  const handle = { fill: '#ffffff', stroke: THEME.accent, width: 2 };
  const nodes = new Set<string>();
  for (const ref of opts.selection) {
    if (ref.coll === 'walls') {
      const w = level.walls[ref.id];
      if (w) {
        nodes.add(w.a);
        nodes.add(w.b);
      }
    } else if (ref.coll === 'nodes') nodes.add(ref.id);
    else if (ref.coll === 'items' && opts.selection.length === 1) {
      const it = level.items[ref.id];
      if (!it || it.locked) continue;
      const rh = rotateHandle(it, p.pxPerMm);
      p.line(itemToWorld(it, { x: 0, y: -it.depth / 2 }), rh, { stroke: THEME.accent, width: 1.5 });
      p.dot(rh, r, handle);
      for (const c of itemCorners(it))
        p.dot(c, r * 0.85, { ...handle, fill: THEME.accent, stroke: '#ffffff' });
    } else if (ref.coll === 'openings') {
      const o = level.openings[ref.id];
      const f = o && openingFrame(level, o);
      if (o && f) {
        p.dot(add(f.center, scale(f.dir, -o.width / 2)), r * 0.85, handle);
        p.dot(add(f.center, scale(f.dir, o.width / 2)), r * 0.85, handle);
      }
    }
  }
  for (const id of nodes) {
    const n = level.nodes[id];
    if (n) p.dot(n, r, handle);
  }
}
