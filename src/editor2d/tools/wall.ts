import type { Command } from '../../commands/commands';
import { add, angleOf, dist, mid, scale } from '../../geometry/vec';
import { formatAngle, formatLength, lengthToInput, parseAngle, parseLength } from '../../model/units';
import type { Vec2 } from '../../model/types';
import type { Painter } from '../painter';
import { THEME } from '../render';
import type { EditorApi, PointerInfo, Tool, ToolAction } from './types';

/** Click-click wall chains with live length/angle, typed lengths, close on start. */
export class WallTool implements Tool {
  readonly id = 'wall' as const;
  cursor = 'crosshair';
  private points: Vec2[] = [];
  private cursorPt: Vec2 | null = null;

  constructor(private api: EditorApi) {}

  hint(): string {
    if (this.points.length === 0) return 'Click to start a wall. Hold Alt to disable snapping.';
    return 'Click to add corners · type a length · Enter/double-click to finish · click the start to close';
  }

  actions(): ToolAction[] {
    if (this.points.length === 0) return [];
    return [
      { label: 'Type length', run: () => this.openNumeric(), primary: true },
      { label: 'Undo point', run: () => this.popPoint() },
      { label: 'Finish', run: () => this.finish(false) },
    ];
  }

  private cmd(points: Vec2[], closed: boolean): Command {
    const s = this.api.store.settings;
    return {
      type: 'addWalls',
      level: this.api.store.levelId,
      points,
      closed,
      thickness: s.wallThickness,
      height: s.wallHeight,
    };
  }

  private updatePreview(): void {
    const pts = this.cursorPt ? [...this.points, this.cursorPt] : this.points;
    this.api.store.preview(pts.length >= 2 ? this.cmd(pts, false) : null);
    this.api.requestRender();
  }

  private snapAt(e: PointerInfo) {
    return this.api.snap(e.world, {
      anchor: this.points[this.points.length - 1],
      alt: e.alt,
      tol: e.tol,
      extraPoints: this.points.slice(0, -1),
    });
  }

  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    const s = this.snapAt(e);
    const first = this.points[0];
    if (first && this.points.length >= 3 && (dist(s.p, first) < e.tol || dist(e.world, first) < e.tol)) {
      this.finish(true);
      return;
    }
    const last = this.points[this.points.length - 1];
    if (last && dist(last, s.p) < 1) return;
    this.points.push(s.p);
    // Ending on an existing corner (not the first point) finishes an open chain.
    if (this.points.length >= 2 && s.kind === 'node' && s.nodeId) {
      this.finish(false);
      return;
    }
    this.cursorPt = s.p;
    this.updatePreview();
    this.api.toolChanged();
  }

  move(e: PointerInfo): void {
    const s = this.snapAt(e);
    this.cursorPt = s.p;
    this.api.setGuides(s.guides);
    if (this.points.length) this.updatePreview();
    else this.api.requestRender();
  }

  up(): void {}

  dblclick(): void {
    this.finish(false);
  }

  private popPoint(): void {
    this.points.pop();
    this.updatePreview();
    this.api.toolChanged();
  }

  finish(closed: boolean): void {
    const pts = this.points;
    this.points = [];
    this.api.store.preview(null);
    if (pts.length >= 2) this.api.store.dispatch(this.cmd(pts, closed));
    this.api.setGuides([]);
    this.api.toolChanged();
    this.api.requestRender();
  }

  cancel(): void {
    if (this.points.length >= 2) this.finish(false);
    this.points = [];
    this.cursorPt = null;
    this.api.store.preview(null);
    this.api.closeNumeric();
    this.api.toolChanged();
  }

  openNumeric(initialText?: string): void {
    const anchor = this.points[this.points.length - 1];
    if (!anchor) return;
    const cur = this.cursorPt ?? add(anchor, { x: 1000, y: 0 });
    const L = dist(anchor, cur);
    const ang = (-angleOf({ x: cur.x - anchor.x, y: cur.y - anchor.y }) * 180) / Math.PI;
    const prefs = this.api.prefs;
    this.api.openNumeric({
      at: this.api.vp.toScreen(cur),
      title: 'Wall',
      initialText,
      fields: [
        { key: 'length', label: 'Length', value: lengthToInput(L, prefs), kind: 'length' },
        { key: 'angle', label: 'Angle', value: String(Math.round(ang * 10) / 10), kind: 'angle' },
      ],
      submitLabel: 'Add',
      onSubmit: (v) => {
        const len = parseLength(v['length'] ?? '', prefs);
        const a = parseAngle(v['angle'] ?? '');
        if (len === null || len <= 0) return 'Enter a length like 3.2 m, 320 cm or 10\' 6"';
        if (a === null) return 'Enter an angle in degrees';
        const rad = (-a * Math.PI) / 180; // degrees counter-clockwise, as on paper
        const p = add(anchor, scale({ x: Math.cos(rad), y: Math.sin(rad) }, len));
        this.points.push(p);
        this.cursorPt = p;
        this.updatePreview();
        this.api.toolChanged();
      },
    });
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    if (e.key === 'Enter') {
      this.finish(false);
      return true;
    }
    if (e.key === 'Backspace' && this.points.length) {
      this.popPoint();
      return true;
    }
    if (this.points.length && /^[0-9.,]$/.test(e.key)) {
      this.openNumeric(e.key);
      return true;
    }
    return false;
  }

  overlay(p: Painter): void {
    const anchor = this.points[this.points.length - 1];
    const cur = this.cursorPt;
    if (cur) p.dot(cur, 4, { fill: THEME.accent });
    if (!anchor || !cur) return;
    const L = dist(anchor, cur);
    if (L < 1) return;
    const ang = (-angleOf({ x: cur.x - anchor.x, y: cur.y - anchor.y }) * 180) / Math.PI;
    const label = `${formatLength(L, this.api.prefs)}  ${formatAngle(((ang % 360) + 360) % 360)}`;
    const m = mid(anchor, cur);
    p.text(add(m, { x: 0, y: -16 / p.pxPerMm }), label, {
      size: 12,
      color: '#ffffff',
      bold: true,
      halo: THEME.accent,
    });
    const first = this.points[0];
    if (first && this.points.length >= 3) p.dot(first, 7, { stroke: THEME.accent, width: 2 });
  }
}
