import type { Command } from '../../commands/commands';
import { dist } from '../../geometry/vec';
import { formatLength, lengthToInput, parseLength } from '../../model/units';
import type { Vec2 } from '../../model/types';
import type { Painter } from '../painter';
import { THEME } from '../render';
import type { EditorApi, PointerInfo, Tool, ToolAction } from './types';

/** Draws a rectangular room by its INTERIOR corners (drag, or click-click, or typed W × H). */
export class RoomTool implements Tool {
  readonly id = 'room' as const;
  cursor = 'crosshair';
  private start: Vec2 | null = null;
  private end: Vec2 | null = null;
  private dragging = false;
  private downAt: Vec2 | null = null;

  constructor(private api: EditorApi) {}

  hint(): string {
    return this.start
      ? 'Drag or click the opposite corner · type W × H for exact interior size'
      : 'Click or drag to draw a room by its inside corners';
  }

  actions(): ToolAction[] {
    return this.start ? [{ label: 'Type size', run: () => this.openNumeric(), primary: true }] : [];
  }

  private cmd(a: Vec2, b: Vec2): Command {
    const s = this.api.store.settings;
    return {
      type: 'addRectRoom',
      level: this.api.store.levelId,
      x: a.x,
      y: a.y,
      w: b.x - a.x,
      h: b.y - a.y,
      thickness: s.wallThickness,
      height: s.wallHeight,
    };
  }

  private preview(): void {
    if (
      this.start &&
      this.end &&
      Math.abs(this.end.x - this.start.x) > 1 &&
      Math.abs(this.end.y - this.start.y) > 1
    ) {
      this.api.store.preview(this.cmd(this.start, this.end));
    } else this.api.store.preview(null);
    this.api.requestRender();
  }

  down(e: PointerInfo): void {
    if (e.button !== 0) return;
    const p = this.api.snap(e.world, { alt: e.alt, tol: e.tol }).p;
    this.downAt = e.screen;
    if (!this.start) {
      this.start = p;
      this.end = p;
      this.dragging = true;
      this.api.toolChanged();
    } else {
      this.end = p;
      this.commit();
    }
  }

  move(e: PointerInfo): void {
    const s = this.api.snap(e.world, { alt: e.alt, tol: e.tol });
    this.api.setGuides(s.guides);
    if (!this.start) return this.api.requestRender();
    this.end = s.p;
    this.preview();
  }

  up(e: PointerInfo): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.downAt && dist(this.downAt, e.screen) > 12 && this.start && this.end) this.commit();
  }

  private commit(): void {
    const a = this.start;
    const b = this.end;
    this.start = this.end = null;
    this.api.store.preview(null);
    if (a && b && Math.abs(b.x - a.x) > 100 && Math.abs(b.y - a.y) > 100)
      this.api.store.dispatch(this.cmd(a, b));
    this.api.setGuides([]);
    this.api.toolChanged();
  }

  cancel(): void {
    this.start = this.end = null;
    this.dragging = false;
    this.api.store.preview(null);
    this.api.closeNumeric();
    this.api.toolChanged();
  }

  openNumeric(initialText?: string): void {
    const a = this.start;
    if (!a) return;
    const b = this.end ?? { x: a.x + 4000, y: a.y + 3000 };
    const prefs = this.api.prefs;
    this.api.openNumeric({
      at: this.api.vp.toScreen(b),
      title: 'Room (inside size)',
      initialText,
      fields: [
        {
          key: 'w',
          label: 'Width',
          value: lengthToInput(Math.abs(b.x - a.x) || 4000, prefs),
          kind: 'length',
        },
        {
          key: 'h',
          label: 'Depth',
          value: lengthToInput(Math.abs(b.y - a.y) || 3000, prefs),
          kind: 'length',
        },
      ],
      submitLabel: 'Create',
      onSubmit: (v) => {
        const w = parseLength(v['w'] ?? '', prefs);
        const h = parseLength(v['h'] ?? '', prefs);
        if (!w || !h || w <= 0 || h <= 0) return "Enter sizes like 4 m, 400 cm or 13'";
        const sx = b.x >= a.x ? 1 : -1;
        const sy = b.y >= a.y ? 1 : -1;
        this.end = { x: a.x + sx * w, y: a.y + sy * h };
        this.commit();
      },
    });
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (!this.start) this.api.setTool('select');
      this.cancel();
      return true;
    }
    if (this.start && /^[0-9.,]$/.test(e.key)) {
      this.openNumeric(e.key);
      return true;
    }
    return false;
  }

  overlay(p: Painter): void {
    const a = this.start;
    const b = this.end;
    if (!a || !b) return;
    const prefs = this.api.prefs;
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (w < 1 || h < 1) return;
    p.text(
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      `${formatLength(w, prefs)} × ${formatLength(h, prefs)}`,
      { size: 13, color: '#fff', bold: true, halo: THEME.accent },
    );
  }
}
