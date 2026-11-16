import { add, dist, mid } from '../../geometry/vec';
import { newId } from '../../model/ids';
import { formatLength, lengthToInput, parseLength } from '../../model/units';
import type { Ref, Vec2 } from '../../model/types';
import type { Painter } from '../painter';
import { drawDimension, THEME } from '../render';
import type { EditorApi, PointerInfo, Tool, ToolAction } from './types';

/** Two clicks create a dimension annotation. */
export class MeasureTool implements Tool {
  readonly id = 'measure' as const;
  cursor = 'crosshair';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  constructor(private api: EditorApi) {}
  hint(): string {
    return this.a
      ? 'Click the second point to keep the dimension · Esc cancels'
      : 'Click two points to measure (snaps to corners and walls)';
  }
  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    const p = this.api.snap(e.world, { alt: e.alt, tol: e.tol, anchor: this.a ?? undefined }).p;
    if (!this.a) {
      this.a = p;
      this.b = p;
      this.api.toolChanged();
      return;
    }
    if (dist(this.a, p) > 10) {
      const s = this.api.store;
      const id = newId('a');
      s.dispatch({
        type: 'add',
        level: s.levelId,
        coll: 'annotations',
        values: [{ id, kind: 'dimension', a: this.a, b: p, offset: 0 }],
      });
    }
    this.a = this.b = null;
    this.api.toolChanged();
  }
  move(e: PointerInfo): void {
    const s = this.api.snap(e.world, { alt: e.alt, tol: e.tol, anchor: this.a ?? undefined });
    this.api.setGuides(s.guides);
    if (this.a) this.b = s.p;
    this.api.requestRender();
  }
  up(): void {}
  cancel(): void {
    this.a = this.b = null;
    this.api.toolChanged();
  }
  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (!this.a) this.api.setTool('select');
      this.cancel();
      return true;
    }
    return false;
  }
  overlay(p: Painter): void {
    if (this.a && this.b && dist(this.a, this.b) > 1) {
      drawDimension(p, this.a, this.b, 0, formatLength(dist(this.a, this.b), this.api.prefs), THEME.accent);
    }
  }
}

/** Click to place a text label. */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  cursor = 'text';
  constructor(private api: EditorApi) {}
  hint(): string {
    return 'Click where the label should go';
  }
  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    const at = e.world;
    this.api.openNumeric({
      at: e.screen,
      title: 'Text label',
      fields: [{ key: 't', label: 'Text', value: '', kind: 'text' }],
      submitLabel: 'Add',
      onSubmit: (v) => {
        const text = (v['t'] ?? '').trim();
        if (!text) return 'Enter some text';
        const s = this.api.store;
        const id = newId('a');
        s.dispatch({
          type: 'add',
          level: s.levelId,
          coll: 'annotations',
          values: [{ id, kind: 'text', x: at.x, y: at.y, text, size: 160 }],
        });
        this.api.select([{ coll: 'annotations', id }]);
        this.api.setTool('select');
      },
    });
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** Tap or drag across things to delete them (one undo step per gesture). */
export class EraseTool implements Tool {
  readonly id = 'erase' as const;
  cursor = 'not-allowed';
  private refs: Ref[] = [];
  constructor(private api: EditorApi) {}
  hint(): string {
    return 'Tap or drag across walls, doors, furniture or labels to delete them';
  }
  private collect(e: PointerInfo): void {
    const h = this.api.hit(e.world, e.tol);
    if (!h || h.part === 'room' || h.ref.coll === 'refImages') return;
    const ref = h.ref.coll === 'nodes' ? h.ref : h.ref;
    if (this.refs.some((r) => r.coll === ref.coll && r.id === ref.id)) return;
    this.refs.push(ref);
    const s = this.api.store;
    s.preview({ type: 'delete', level: s.levelId, refs: this.refs });
    this.api.requestRender();
  }
  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.refs = [];
    this.collect(e);
  }
  move(e: PointerInfo, pressed: boolean): void {
    if (pressed) this.collect(e);
    else {
      const h = this.api.hit(e.world, e.tol);
      this.api.store.setHover(h && h.part !== 'room' ? h.ref : null);
    }
  }
  up(): void {
    const s = this.api.store;
    s.preview(null);
    if (this.refs.length) s.dispatch({ type: 'delete', level: s.levelId, refs: this.refs });
    this.refs = [];
  }
  cancel(): void {
    this.refs = [];
    this.api.store.preview(null);
  }
}

export class PanTool implements Tool {
  readonly id = 'pan' as const;
  cursor = 'grab';
  private last: Vec2 | null = null;
  constructor(private api: EditorApi) {}
  hint(): string {
    return 'Drag to pan · pinch or scroll to zoom';
  }
  down(e: PointerInfo): void {
    this.last = e.screen;
    this.cursor = 'grabbing';
  }
  move(e: PointerInfo, pressed: boolean): void {
    if (!pressed || !this.last) return;
    this.api.vp.panBy(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = e.screen;
    this.api.requestRender();
  }
  up(): void {
    this.last = null;
    this.cursor = 'grab';
  }
  cancel(): void {
    this.last = null;
  }
}

/** Reference-image scale calibration: click two points with a known real distance. */
export class CalibrateTool implements Tool {
  readonly id = 'calibrate' as const;
  cursor = 'crosshair';
  imageId: string | null = null;
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  constructor(private api: EditorApi) {}
  hint(): string {
    return this.a
      ? 'Click the second point of a distance you know (e.g. the far end of a wall)'
      : 'Calibrate: click the first point of a distance you know on the image';
  }
  actions(): ToolAction[] {
    return [{ label: 'Cancel', run: () => this.api.setTool('select') }];
  }
  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    if (!this.a) {
      this.a = e.world;
      this.b = e.world;
      this.api.toolChanged();
      return;
    }
    this.b = e.world;
    const a = this.a;
    const b = this.b;
    const measured = dist(a, b);
    if (measured < 1) return;
    this.api.openNumeric({
      at: e.screen,
      title: 'Real distance between the two points',
      fields: [
        { key: 'd', label: 'Distance', value: lengthToInput(measured, this.api.prefs), kind: 'length' },
      ],
      submitLabel: 'Set scale',
      onSubmit: (v) => {
        const real = parseLength(v['d'] ?? '', this.api.prefs);
        if (!real || real <= 0) return 'Enter the real distance, e.g. 3.6 m';
        const s = this.api.store;
        const im = this.imageId ? s.committedLevel.refImages[this.imageId] : undefined;
        if (!im) return;
        const k = real / measured;
        // Scale about point a so the first clicked point stays put.
        const c = add(a, { x: (im.x - a.x) * k, y: (im.y - a.y) * k });
        s.dispatch({
          type: 'update',
          level: s.levelId,
          coll: 'refImages',
          id: im.id,
          patch: { mmPerPx: im.mmPerPx * k, x: c.x, y: c.y },
        });
        this.api.toast(`Scale set: ${formatLength(real, this.api.prefs)} between the points`);
        this.a = this.b = null;
        this.api.setTool('select');
        requestAnimationFrame(() => this.api.fitView());
      },
      onCancel: () => {
        this.a = this.b = null;
        this.api.toolChanged();
      },
    });
  }
  move(e: PointerInfo): void {
    if (this.a) {
      this.b = e.world;
      this.api.requestRender();
    }
  }
  up(): void {}
  cancel(): void {
    this.a = this.b = null;
  }
  overlay(p: Painter): void {
    if (!this.a || !this.b) return;
    p.line(this.a, this.b, { stroke: '#e0457b', width: 2.5 });
    p.dot(this.a, 6, { fill: '#e0457b', stroke: '#fff', width: 2 });
    p.dot(this.b, 6, { fill: '#e0457b', stroke: '#fff', width: 2 });
    p.text(
      add(mid(this.a, this.b), { x: 0, y: -14 / p.pxPerMm }),
      formatLength(dist(this.a, this.b), this.api.prefs),
      {
        size: 12,
        color: '#fff',
        bold: true,
        halo: '#e0457b',
      },
    );
  }
}
