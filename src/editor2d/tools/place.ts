import { catalogEntry } from '../../catalog/catalog';
import type { Footprints } from '../../geometry/footprints';
import { rightNormal } from '../../geometry/rooms';
import { dist, dot, leftNormal, norm, pointInPolygon, projectOnSegment, sub } from '../../geometry/vec';
import { newId } from '../../model/ids';
import { formatLength } from '../../model/units';
import type { Item, Level, Opening, OpeningKind, Vec2 } from '../../model/types';
import type { Painter } from '../painter';
import { THEME } from '../render';
import type { EditorApi, PointerInfo, Tool, ToolAction } from './types';

export const OPENING_DEFAULTS: Record<
  OpeningKind,
  { width: number; height: number; sill: number; label: string }
> = {
  door: { width: 800, height: 2000, sill: 0, label: 'Door' },
  'double-door': { width: 1400, height: 2000, sill: 0, label: 'Double door' },
  'sliding-door': { width: 1600, height: 2100, sill: 0, label: 'Sliding door' },
  window: { width: 1200, height: 1200, sill: 900, label: 'Window' },
  opening: { width: 900, height: 2100, sill: 0, label: 'Opening' },
};

/** Snaps an item's back against the nearest wall face within `tol` mm. */
export function magnetToWall(
  fp: Footprints,
  it: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation'>,
  tol: number,
): { x: number; y: number; rotation: number } | null {
  let best: { x: number; y: number; rotation: number; err: number } | null = null;
  const c = { x: it.x, y: it.y };
  for (const w of fp.walls.values()) {
    for (const [face, outward] of [
      [w.right, rightNormal(norm(sub(w.axis[1], w.axis[0])))],
      [w.left, leftNormal(norm(sub(w.axis[1], w.axis[0])))],
    ] as const) {
      const [s0, s1] = face;
      const sd = dot(sub(c, s0), outward);
      const err = Math.abs(sd - it.depth / 2);
      if (sd < 0 || err > tol) continue;
      const pr = projectOnSegment(c, s0, s1);
      if (pr.t <= 0 || pr.t >= 1) continue;
      if (!best || err < best.err) {
        const rotation = (Math.atan2(-outward.x, outward.y) * 180) / Math.PI;
        best = {
          x: pr.point.x + outward.x * (it.depth / 2),
          y: pr.point.y + outward.y * (it.depth / 2),
          rotation: Math.round(rotation * 1000) / 1000,
          err,
        };
      }
    }
  }
  return best ? { x: best.x, y: best.y, rotation: best.rotation } : null;
}

/**
 * Nearest wall under a point with the projected offset along its axis. `side` is
 * the side the pointer is on; when the pointer is on the wall itself it prefers
 * the side that has a room (so doors swing inwards by default).
 */
export function wallUnder(
  level: Level,
  fp: Footprints,
  p: Vec2,
  tol: number,
  rooms: readonly (readonly Vec2[])[] = [],
) {
  let best: { wallId: string; offset: number; side: 'l' | 'r'; d: number; length: number } | null = null;
  for (const [id, f] of fp.walls) {
    const w = level.walls[id];
    if (!w) continue;
    const pr = projectOnSegment(p, f.axis[0], f.axis[1]);
    if (pr.dist > w.thickness / 2 + tol) continue;
    if (!best || pr.dist < best.d) {
      const dir = norm(sub(f.axis[1], f.axis[0]));
      const ln = leftNormal(dir);
      const along = dot(sub(p, pr.point), ln);
      let side: 'l' | 'r' = along >= 0 ? 'l' : 'r';
      if (Math.abs(along) <= w.thickness / 2 && rooms.length) {
        const probe = {
          x: pr.point.x + ln.x * (w.thickness / 2 + 150),
          y: pr.point.y + ln.y * (w.thickness / 2 + 150),
        };
        const leftRoom = rooms.some((r) => pointInPolygon(probe, r));
        const probeR = {
          x: pr.point.x - ln.x * (w.thickness / 2 + 150),
          y: pr.point.y - ln.y * (w.thickness / 2 + 150),
        };
        const rightRoom = rooms.some((r) => pointInPolygon(probeR, r));
        if (leftRoom !== rightRoom) side = leftRoom ? 'l' : 'r';
      }
      best = { wallId: id, offset: pr.t * f.length, side, d: pr.dist, length: f.length };
    }
  }
  return best;
}

export class OpeningTool implements Tool {
  cursor = 'copy';
  private ghost: Opening | null = null;

  constructor(
    readonly id: 'door' | 'window',
    private api: EditorApi,
  ) {}

  private kind(): OpeningKind {
    const o = this.api.store.toolOptions;
    return this.id === 'door' ? o.doorKind : o.windowKind;
  }

  hint(): string {
    return `Hover a wall and click to place a ${OPENING_DEFAULTS[this.kind()].label.toLowerCase()} · Shift flips the hinge`;
  }

  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.move(e);
    const g = this.ghost;
    if (!g) return this.api.toast('Place doors and windows on a wall');
    this.api.store.preview(null);
    this.api.store.dispatch({ type: 'add', level: this.api.store.levelId, coll: 'openings', values: [g] });
    this.ghost = null;
    this.api.select([{ coll: 'openings', id: g.id }]);
    if (!e.shift && e.type !== 'mouse') this.api.setTool('select');
  }

  move(e: PointerInfo): void {
    const s = this.api.store;
    const lv = s.committedLevel;
    const d = s.committedDerived;
    const hit = wallUnder(
      lv,
      d.footprints,
      e.world,
      e.tol,
      d.rooms.map((r) => r.polygon),
    );
    if (!hit) {
      this.ghost = null;
      s.preview(null);
      return;
    }
    const k = this.kind();
    const def = OPENING_DEFAULTS[k];
    const width = Math.min(def.width, hit.length);
    const offset = Math.min(Math.max(Math.round(hit.offset / 10) * 10, width / 2), hit.length - width / 2);
    this.ghost = {
      id: this.ghost?.id ?? newId('o'),
      wallId: hit.wallId,
      kind: k,
      offset,
      width,
      height: def.height,
      sill: def.sill,
      hinge: e.shift ? 'b' : 'a',
      side: hit.side,
    };
    s.preview({ type: 'add', level: s.levelId, coll: 'openings', values: [this.ghost] });
    this.api.requestRender();
  }

  up(): void {}

  cancel(): void {
    this.ghost = null;
    this.api.store.preview(null);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.cancel();
      this.api.setTool('select');
      return true;
    }
    return false;
  }

  overlay(p: Painter): void {
    const g = this.ghost;
    if (!g) return;
    const lv = this.api.store.level;
    const fp = this.api.store.derived.footprints.walls.get(g.wallId);
    if (!fp) return;
    // Distances from the opening edges to the inner wall corners on the swing side.
    const face = g.side === 'l' ? fp.left : fp.right;
    const dir = norm(sub(fp.axis[1], fp.axis[0]));
    const a = {
      x: fp.axis[0].x + dir.x * (g.offset - g.width / 2),
      y: fp.axis[0].y + dir.y * (g.offset - g.width / 2),
    };
    const b = {
      x: fp.axis[0].x + dir.x * (g.offset + g.width / 2),
      y: fp.axis[0].y + dir.y * (g.offset + g.width / 2),
    };
    const pa = projectOnSegment(a, face[0], face[1]).point;
    const pb = projectOnSegment(b, face[0], face[1]).point;
    const ends = [
      [face[0], pa],
      [pb, face[1]],
    ] as const;
    for (const [u, v] of ends) {
      const L = dist(u, v);
      if (L < 1) continue;
      p.line(u, v, { stroke: THEME.accent, width: 1.5 });
      p.text({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 }, formatLength(L, this.api.prefs), {
        size: 11,
        color: '#fff',
        bold: true,
        halo: THEME.accent,
      });
    }
    void lv;
  }
}

export class FurnitureTool implements Tool {
  readonly id = 'furniture' as const;
  cursor = 'copy';
  private ghost: Item | null = null;
  private rotation = 0;

  constructor(private api: EditorApi) {}

  hint(): string {
    const e = catalogEntry(this.api.store.toolOptions.catalogId);
    return `Click to place ${e?.name ?? 'item'} · R rotates · near a wall it turns its back to the wall (Alt: off)`;
  }

  actions(): ToolAction[] {
    return [
      { label: 'Rotate 90°', run: () => this.rotate(90) },
      { label: 'Done', run: () => this.api.setTool('select') },
    ];
  }

  private rotate(d: number): void {
    this.rotation = (((this.rotation + d) % 360) + 360) % 360;
    if (this.ghost) {
      this.ghost = { ...this.ghost, rotation: this.rotation };
      this.api.store.preview({
        type: 'add',
        level: this.api.store.levelId,
        coll: 'items',
        values: [this.ghost],
      });
    }
  }

  move(e: PointerInfo): void {
    const s = this.api.store;
    const entry = catalogEntry(s.toolOptions.catalogId);
    if (!entry) return;
    let it: Item = {
      id: this.ghost?.id ?? newId('i'),
      catalogId: entry.id,
      x: Math.round(e.world.x / 10) * 10,
      y: Math.round(e.world.y / 10) * 10,
      rotation: this.rotation,
      width: entry.dims.width,
      depth: entry.dims.depth,
      height: entry.dims.height,
      elevation: entry.elevation,
    };
    if (!e.alt && s.settings.snap && entry.category !== 'rug') {
      const tol = Math.max(250, e.tol * 2);
      const m = magnetToWall(s.committedDerived.footprints, it, entry.mount === 'wall' ? tol * 2 : tol);
      if (m) it = { ...it, ...m };
    }
    this.ghost = it;
    s.preview({ type: 'add', level: s.levelId, coll: 'items', values: [it] });
    this.api.requestRender();
  }

  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.move(e);
    const g = this.ghost;
    if (!g) return;
    this.api.store.preview(null);
    this.api.store.dispatch({ type: 'add', level: this.api.store.levelId, coll: 'items', values: [g] });
    this.ghost = null;
    this.api.select([{ coll: 'items', id: g.id }]);
    if (!e.shift) this.api.setTool('select');
  }

  up(): void {}

  cancel(): void {
    this.ghost = null;
    this.api.store.preview(null);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.cancel();
      this.api.setTool('select');
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.rotate(e.shiftKey ? -90 : 90);
      this.api.requestRender();
      return true;
    }
    return false;
  }
}
