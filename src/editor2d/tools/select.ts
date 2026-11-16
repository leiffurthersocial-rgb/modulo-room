import { catalogEntry } from '../../catalog/catalog';
import type { Command } from '../../commands/commands';
import { itemCorners, worldToItem, itemToWorld } from '../../geometry/collide';
import { add, dist, dot, leftNormal, norm, projectOnSegment, rotate, sub } from '../../geometry/vec';
import { snapAngle } from '../../geometry/snap';
import type { Item, Ref, Vec2 } from '../../model/types';
import { refsInRect, type Hit } from '../hit';
import type { Painter } from '../painter';
import { THEME } from '../render';
import { magnetToWall, wallUnder } from './place';
import type { EditorApi, PointerInfo, Tool, ToolAction } from './types';
import { editWallLength, editRoomEdge, editItemSize, editOpening, renameRoom, editText } from './edits';

type Drag =
  | { kind: 'none' }
  | { kind: 'pending'; hit: Hit | null; start: PointerInfo }
  | { kind: 'node'; id: string; start: Vec2 }
  | { kind: 'walls'; ids: string[]; start: Vec2; normal: Vec2 | null }
  | { kind: 'items'; refs: Ref[]; start: Vec2; single: Item | null }
  | { kind: 'rotate'; item: Item }
  | { kind: 'corner'; item: Item; index: number }
  | { kind: 'opening'; id: string; grab: number }
  | { kind: 'opening-end'; id: string; end: 'a' | 'b' }
  | { kind: 'marquee'; start: Vec2; end: Vec2 }
  | { kind: 'pan'; last: Vec2 };

const DRAG_PX: Record<string, number> = { mouse: 4, pen: 6, touch: 10 };

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'default';
  private drag: Drag = { kind: 'none' };

  constructor(private api: EditorApi) {}

  hint(): string {
    const sel = this.api.store.selection;
    if (sel.length === 1) {
      const r = sel[0] as Ref;
      if (r.coll === 'walls')
        return 'Drag to move the wall · double-click or tap its length to edit · Delete removes';
      if (r.coll === 'items')
        return 'Drag to move · round handle rotates · corners resize · R rotates 90° · Delete removes';
      if (r.coll === 'openings')
        return 'Drag along the wall or onto another wall · end handles change the width';
      if (r.coll === 'rooms') return 'Double-click to rename · tap a dimension to set an exact size';
    }
    if (sel.length > 1)
      return `${sel.length} selected · drag to move · Delete removes · Ctrl+C / Ctrl+V copy`;
    return 'Click to select · drag empty space to box-select (one finger pans on touch) · tap a dimension to edit it';
  }

  actions(): ToolAction[] {
    const s = this.api.store;
    const sel = s.selection;
    if (!sel.length) return [];
    const out: ToolAction[] = [];
    const items = sel.filter((r) => r.coll === 'items');
    if (items.length) out.push({ label: 'Rotate 90°', run: () => this.rotateSelection(90) });
    if (sel.length === 1 && sel[0]?.coll === 'walls')
      out.push({ label: 'Edit length', run: () => editWallLength(this.api, sel[0]?.id ?? '') });
    if (sel.length === 1 && sel[0]?.coll === 'rooms')
      out.push({ label: 'Rename', run: () => renameRoom(this.api, sel[0]?.id ?? '') });
    if (sel.some((r) => r.coll === 'items' || r.coll === 'walls' || r.coll === 'annotations'))
      out.push({ label: 'Duplicate', run: () => this.duplicate() });
    out.push({ label: 'Delete', run: () => this.deleteSelection(), danger: true });
    return out;
  }

  // ---------- pointer ----------
  down(e: PointerInfo): void {
    if (e.button === 2) return;
    // Clickable dimension labels take priority.
    const hl = this.api.hotLabelAt(e.screen);
    if (hl) {
      this.drag = { kind: 'none' };
      if (hl.kind === 'roomEdge' && hl.roomId !== undefined && hl.edge !== undefined)
        editRoomEdge(this.api, hl.roomId, hl.edge, e.screen);
      else if (hl.kind === 'wallLength' && hl.wallId) editWallLength(this.api, hl.wallId);
      return;
    }
    const hit = this.api.hit(e.world, e.tol);
    this.drag = { kind: 'pending', hit, start: e };
  }

  move(e: PointerInfo, pressed: boolean): void {
    const s = this.api.store;
    if (!pressed || this.drag.kind === 'none') {
      const h = this.api.hit(e.world, e.tol);
      s.setHover(h && h.part !== 'room' ? h.ref : (h?.ref ?? null));
      this.cursor = h
        ? h.part === 'item-rotate'
          ? 'grab'
          : h.part === 'room'
            ? 'default'
            : 'move'
        : 'default';
      return;
    }
    if (this.drag.kind === 'pending') {
      const st = this.drag.start;
      if (dist(st.screen, e.screen) < (DRAG_PX[e.type] ?? 4)) return;
      this.beginDrag(this.drag.hit, st);
    }
    this.updateDrag(e);
  }

  private beginDrag(hit: Hit | null, st: PointerInfo): void {
    const s = this.api.store;
    const lv = s.committedLevel;
    if (!hit || hit.part === 'room' || (hit.part === 'refImage' && lv.refImages[hit.ref.id]?.locked)) {
      this.drag =
        st.type === 'touch'
          ? { kind: 'pan', last: st.screen }
          : { kind: 'marquee', start: st.world, end: st.world };
      return;
    }
    if (!s.isSelected(hit.ref)) this.api.select(st.shift ? [...s.selection, hit.ref] : [hit.ref]);
    switch (hit.part) {
      case 'node':
        this.drag = { kind: 'node', id: hit.ref.id, start: st.world };
        return;
      case 'wall': {
        const ids = s.selection.filter((r) => r.coll === 'walls').map((r) => r.id);
        const w = lv.walls[hit.ref.id];
        const a = w && lv.nodes[w.a];
        const b = w && lv.nodes[w.b];
        const normal = a && b && ids.length === 1 ? leftNormal(norm(sub(b, a))) : null;
        this.drag = { kind: 'walls', ids, start: st.world, normal };
        return;
      }
      case 'opening': {
        const o = lv.openings[hit.ref.id];
        const w = o && wallUnder(lv, s.committedDerived.footprints, st.world, 10_000);
        this.drag = { kind: 'opening', id: hit.ref.id, grab: o && w ? w.offset - o.offset : 0 };
        return;
      }
      case 'opening-end-a':
      case 'opening-end-b':
        this.drag = { kind: 'opening-end', id: hit.ref.id, end: hit.part === 'opening-end-a' ? 'a' : 'b' };
        return;
      case 'item-rotate': {
        const it = lv.items[hit.ref.id];
        if (it) this.drag = { kind: 'rotate', item: it };
        return;
      }
      case 'item-corner': {
        const it = lv.items[hit.ref.id];
        if (it) this.drag = { kind: 'corner', item: it, index: hit.index ?? 0 };
        return;
      }
      default: {
        const refs = s.selection.filter(
          (r) =>
            r.coll === 'items' || r.coll === 'annotations' || r.coll === 'refImages' || r.coll === 'walls',
        );
        const locked = refs.some((r) => r.coll === 'items' && lv.items[r.id]?.locked);
        if (locked) {
          this.api.toast('Item is locked');
          this.drag = { kind: 'none' };
          return;
        }
        const single = refs.length === 1 && refs[0]?.coll === 'items' ? (lv.items[refs[0].id] ?? null) : null;
        this.drag = { kind: 'items', refs, start: st.world, single };
      }
    }
  }

  private previewCmd(): Command | null {
    return null;
  }

  private lastCmd: Command | null = null;

  private setPreview(cmd: Command | null): void {
    this.lastCmd = cmd;
    this.api.store.preview(cmd);
    this.api.requestRender();
  }

  private updateDrag(e: PointerInfo): void {
    const s = this.api.store;
    const lv = s.committedLevel;
    const L = s.levelId;
    const d = this.drag;
    switch (d.kind) {
      case 'pan':
        this.api.vp.panBy(e.screen.x - d.last.x, e.screen.y - d.last.y);
        d.last = e.screen;
        this.api.requestRender();
        return;
      case 'marquee':
        d.end = e.world;
        this.api.requestRender();
        return;
      case 'node': {
        const sn = this.api.snap(e.world, { excludeNodes: new Set([d.id]), alt: e.alt, tol: e.tol });
        this.api.setGuides(sn.guides);
        this.setPreview({ type: 'setNodePos', level: L, id: d.id, x: sn.p.x, y: sn.p.y });
        return;
      }
      case 'walls': {
        let delta = sub(e.world, d.start);
        if (d.normal && !e.shift) {
          const k = dot(delta, d.normal);
          delta = { x: d.normal.x * k, y: d.normal.y * k };
        }
        delta = { x: Math.round(delta.x / 10) * 10, y: Math.round(delta.y / 10) * 10 };
        this.setPreview({
          type: 'moveEntities',
          level: L,
          refs: d.ids.map((id) => ({ coll: 'walls', id })),
          dx: delta.x,
          dy: delta.y,
        });
        return;
      }
      case 'items': {
        const delta = sub(e.world, d.start);
        if (d.single) {
          const it = d.single;
          let next: Item = {
            ...it,
            x: Math.round((it.x + delta.x) / 10) * 10,
            y: Math.round((it.y + delta.y) / 10) * 10,
          };
          const entry = catalogEntry(it.catalogId);
          if (!e.alt && s.settings.snap && entry?.category !== 'rug') {
            const m = magnetToWall(s.committedDerived.footprints, next, Math.max(150, e.tol * 1.5));
            if (m) next = { ...next, ...m };
          }
          this.setPreview({
            type: 'update',
            level: L,
            coll: 'items',
            id: it.id,
            patch: { x: next.x, y: next.y, rotation: next.rotation },
          });
        } else {
          this.setPreview({
            type: 'moveEntities',
            level: L,
            refs: d.refs,
            dx: Math.round(delta.x / 10) * 10,
            dy: Math.round(delta.y / 10) * 10,
          });
        }
        return;
      }
      case 'rotate': {
        const it = d.item;
        const v = sub(e.world, it);
        // handle sits behind the item (local -y): angle of v relative to "up"
        let deg = (Math.atan2(v.x, -v.y) * 180) / Math.PI;
        if (!e.alt) deg = snapAngle(deg, 15);
        deg = ((deg % 360) + 360) % 360;
        this.setPreview({ type: 'update', level: L, coll: 'items', id: it.id, patch: { rotation: deg } });
        return;
      }
      case 'corner': {
        const it = d.item;
        const cs = itemCorners(it);
        const opp = cs[(d.index + 2) % 4] as Vec2;
        const pl = worldToItem(it, e.world);
        const ol = worldToItem(it, opp);
        const w = Math.max(50, Math.round(Math.abs(pl.x - ol.x) / 10) * 10);
        const dp = Math.max(50, Math.round(Math.abs(pl.y - ol.y) / 10) * 10);
        const cl = {
          x: ol.x + (Math.sign(pl.x - ol.x) * w) / 2,
          y: ol.y + (Math.sign(pl.y - ol.y) * dp) / 2,
        };
        const c = itemToWorld(it, cl);
        this.setPreview({
          type: 'update',
          level: L,
          coll: 'items',
          id: it.id,
          patch: { width: w, depth: dp, x: c.x, y: c.y },
        });
        return;
      }
      case 'opening': {
        const o = lv.openings[d.id];
        if (!o) return;
        const w = wallUnder(lv, s.committedDerived.footprints, e.world, e.tol * 2);
        if (w && w.wallId !== o.wallId) {
          this.setPreview({
            type: 'update',
            level: L,
            coll: 'openings',
            id: o.id,
            patch: { wallId: w.wallId, offset: Math.round(w.offset / 10) * 10, side: w.side },
          });
          return;
        }
        const fp = s.committedDerived.footprints.walls.get(o.wallId);
        if (!fp) return;
        const pr = projectOnSegment(e.world, fp.axis[0], fp.axis[1]);
        const off = Math.round((pr.t * fp.length - d.grab) / 10) * 10;
        this.setPreview({ type: 'update', level: L, coll: 'openings', id: o.id, patch: { offset: off } });
        return;
      }
      case 'opening-end': {
        const o = lv.openings[d.id];
        const fp = o && s.committedDerived.footprints.walls.get(o.wallId);
        if (!o || !fp) return;
        const t = projectOnSegment(e.world, fp.axis[0], fp.axis[1]).t * fp.length;
        const fixed = d.end === 'a' ? o.offset + o.width / 2 : o.offset - o.width / 2;
        const width = Math.max(300, Math.round(Math.abs(fixed - t) / 10) * 10);
        const offset = d.end === 'a' ? fixed - width / 2 : fixed + width / 2;
        this.setPreview({ type: 'update', level: L, coll: 'openings', id: o.id, patch: { width, offset } });
        return;
      }
    }
  }

  up(e: PointerInfo): void {
    const s = this.api.store;
    const d = this.drag;
    this.drag = { kind: 'none' };
    this.api.setGuides([]);
    if (d.kind === 'pending') {
      // A click: select / toggle.
      const ref = d.hit?.ref ?? null;
      if (!ref) {
        if (!e.shift) this.api.select([]);
      } else if (e.shift) {
        this.api.select(
          s.isSelected(ref)
            ? s.selection.filter((r) => !(r.coll === ref.coll && r.id === ref.id))
            : [...s.selection, ref],
        );
      } else this.api.select([ref]);
      return;
    }
    if (d.kind === 'marquee') {
      const refs = refsInRect(s.committedLevel, s.committedDerived, d.start, d.end);
      this.api.select(e.shift ? [...s.selection, ...refs] : refs);
      this.api.requestRender();
      return;
    }
    if (this.lastCmd) {
      const cmd = this.lastCmd;
      this.lastCmd = null;
      s.preview(null);
      s.dispatch(cmd);
    }
    void this.previewCmd;
  }

  dblclick(e: PointerInfo): void {
    const h = this.api.hit(e.world, e.tol);
    if (!h) return;
    if (h.ref.coll === 'walls') editWallLength(this.api, h.ref.id);
    else if (h.ref.coll === 'rooms') renameRoom(this.api, h.ref.id);
    else if (h.ref.coll === 'items') editItemSize(this.api, h.ref.id, e.screen);
    else if (h.ref.coll === 'openings') editOpening(this.api, h.ref.id, e.screen);
    else if (h.ref.coll === 'annotations') editText(this.api, h.ref.id, e.screen);
  }

  cancel(): void {
    this.drag = { kind: 'none' };
    this.lastCmd = null;
    this.api.store.preview(null);
    this.api.setGuides([]);
  }

  // ---------- commands on the selection ----------
  rotateSelection(deg: number): void {
    const s = this.api.store;
    const items = s.selection.filter((r) => r.coll === 'items');
    if (!items.length) return;
    const lv = s.level;
    s.dispatch({
      type: 'updateMany',
      level: s.levelId,
      coll: 'items',
      patches: items.flatMap((r) => {
        const it = lv.items[r.id];
        return it ? [{ id: r.id, patch: { rotation: (((it.rotation + deg) % 360) + 360) % 360 } }] : [];
      }),
    });
  }

  deleteSelection(): void {
    const s = this.api.store;
    if (!s.selection.length) return;
    s.dispatch({ type: 'delete', level: s.levelId, refs: s.selection });
    this.api.select([]);
  }

  duplicate(): void {
    this.api.store.touchView();
    document.dispatchEvent(new CustomEvent('mr:duplicate'));
  }

  nudge(dx: number, dy: number): void {
    const s = this.api.store;
    const refs = s.selection.filter((r) => r.coll !== 'rooms' && r.coll !== 'openings');
    if (refs.length) s.dispatch({ type: 'moveEntities', level: s.levelId, refs, dx, dy });
  }

  key(e: KeyboardEvent): boolean {
    const s = this.api.store;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelection();
      return true;
    }
    if (e.key === 'Escape') {
      this.cancel();
      this.api.select([]);
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
      this.rotateSelection(e.shiftKey ? -90 : 90);
      return true;
    }
    const step = e.shiftKey ? 100 : 10;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const a = arrows[e.key];
    if (a && s.selection.length) {
      this.nudge(a[0], a[1]);
      return true;
    }
    if (e.key === 'Enter' && s.selection.length === 1) {
      const r = s.selection[0] as Ref;
      if (r.coll === 'walls') editWallLength(this.api, r.id);
      else if (r.coll === 'rooms') renameRoom(this.api, r.id);
      else if (r.coll === 'items')
        editItemSize(this.api, r.id, this.api.vp.toScreen(s.level.items[r.id] ?? { x: 0, y: 0 }));
      return true;
    }
    return false;
  }

  overlay(p: Painter): void {
    const d = this.drag;
    if (d.kind === 'marquee') {
      const a = d.start;
      const b = d.end;
      p.poly([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], {
        fill: THEME.accentSoft,
        stroke: THEME.accent,
        width: 1,
        dash: [5, 3],
      });
    }
    if (d.kind === 'rotate') {
      const it = this.api.store.level.items[d.item.id];
      if (it) {
        const tip = add(
          it,
          rotate({ x: 0, y: -Math.max(it.depth, it.width) * 0.75 }, (it.rotation * Math.PI) / 180),
        );
        p.line(it, tip, { stroke: THEME.accent, width: 1, dash: [4, 3] });
        p.text(tip, `${Math.round(it.rotation)}°`, {
          size: 12,
          color: '#fff',
          bold: true,
          halo: THEME.accent,
        });
      }
    }
  }
}
