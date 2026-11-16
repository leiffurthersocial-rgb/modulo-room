import type { Store, ToolId } from '../app/store';
import { snapPoint, type Guide, type SnapResult } from '../geometry/snap';
import { bbox } from '../geometry/vec';
import { itemCorners } from '../geometry/collide';
import { formatLength, type UnitPrefs } from '../model/units';
import type { Ref, Vec2 } from '../model/types';
import { hitTest, type Hit } from './hit';
import { CanvasPainter } from './painter';
import { drawPlan, THEME, type HotLabel } from './render';
import { EditTools } from './tools/registry';
import type { EditorApi, NumericRequest, PointerInfo, PointerKind, SnapOpts, Tool } from './tools/types';
import { Viewport } from './viewport';

export interface EditorHooks {
  openNumeric(req: NumericRequest): void;
  closeNumeric(): void;
  numericOpen(): boolean;
  contextMenu(screen: Vec2, hit: Hit | null): void;
  toast(msg: string): void;
  toolChanged(): void;
  cursorMoved(world: Vec2 | null, snap: SnapResult['kind']): void;
}

const TOL_PX: Record<PointerKind, number> = { mouse: 7, pen: 9, touch: 22 };
const LONG_PRESS_MS = 550;

export class Editor implements EditorApi {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly vp = new Viewport();
  readonly tools: Record<ToolId, Tool>;
  readonly kit: EditTools;
  private guides: Guide[] = [];
  private hot: HotLabel[] = [];
  readonly images = new Map<string, CanvasImageSource>();
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number; type: PointerKind }>();
  private activeId: number | null = null;
  private gesture: { dist: number; cx: number; cy: number } | null = null;
  private suppressUntilUp = false;
  private penUntil = 0;
  private longPress: { timer: number; x: number; y: number } | null = null;
  private lastUp: { t: number; x: number; y: number } | null = null;
  private spaceDown = false;
  private spacePan: Vec2 | null = null;
  private lastKind: PointerKind = 'mouse';
  /** True when the last real input was touch (bigger handles). */
  touchMode = false;
  private resizeObs: ResizeObserver;

  constructor(
    host: HTMLElement,
    readonly store: Store,
    private hooks: EditorHooks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.setAttribute('aria-label', 'Floor plan editor');
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.kit = new EditTools(this);
    this.tools = this.kit.all;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.bindInput();
    store.subscribe((reason) => {
      if (reason === 'tool') this.onToolChange();
      this.requestRender();
    });
  }

  get tool(): Tool {
    return this.tools[this.store.tool];
  }

  get prefs(): UnitPrefs {
    const s = this.store.settings;
    return { units: s.units, metricUnit: s.metricUnit };
  }

  private lastTool: ToolId = 'select';
  private onToolChange(): void {
    if (this.lastTool !== this.store.tool) {
      this.tools[this.lastTool].cancel();
      this.lastTool = this.store.tool;
      this.tool.activate?.();
      this.guides = [];
      this.canvas.style.cursor = this.tool.cursor;
      this.hooks.toolChanged();
    }
  }

  // ---------------- EditorApi ----------------
  snap(raw: Vec2, o: SnapOpts = {}): SnapResult {
    const s = this.store.settings;
    const r = snapPoint(raw, {
      level: this.store.committedLevel,
      tol: o.tol ?? TOL_PX.mouse / this.vp.scale,
      anchor: o.anchor,
      angleStep: s.angleStep,
      grid: s.gridSize,
      lengthStep: 10,
      enabled: s.snap && !o.alt,
      ...(o.excludeNodes ? { excludeNodes: o.excludeNodes } : {}),
      ...(o.excludeWalls ? { excludeWalls: o.excludeWalls } : {}),
      ...(o.extraPoints ? { extraPoints: o.extraPoints } : {}),
    });
    this.hooks.cursorMoved(r.p, r.kind);
    return r;
  }

  setGuides(g: Guide[]): void {
    this.guides = g;
    this.requestRender();
  }

  hit(p: Vec2, tol: number): Hit | null {
    return hitTest(this.store.committedLevel, this.store.committedDerived, p, {
      tol,
      pxPerMm: this.vp.scale,
      selection: this.store.selection,
    });
  }

  hotLabelAt(screen: Vec2): HotLabel | null {
    const pad = this.touchMode ? 8 : 2;
    for (const h of this.hot) {
      const c = this.vp.toScreen(h.center);
      if (Math.abs(screen.x - c.x) < h.w / 2 + pad && Math.abs(screen.y - c.y) < h.h / 2 + pad) return h;
    }
    return null;
  }

  openNumeric(req: NumericRequest): void {
    this.hooks.openNumeric(req);
  }
  closeNumeric(): void {
    this.hooks.closeNumeric();
  }
  numericOpen(): boolean {
    return this.hooks.numericOpen();
  }
  contextMenu(screen: Vec2, hit: Hit | null): void {
    this.hooks.contextMenu(screen, hit);
  }
  setTool(id: ToolId): void {
    this.store.setTool(id);
  }
  select(refs: Ref[]): void {
    this.store.select(refs);
    this.hooks.toolChanged();
  }
  toolChanged(): void {
    this.hooks.toolChanged();
  }
  toast(msg: string): void {
    this.hooks.toast(msg);
  }

  // ---------------- view ----------------
  private resize(): void {
    const host = this.canvas.parentElement;
    if (!host) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const firstSize = this.vp.width === 800 && this.vp.height === 600;
    this.vp.width = w;
    this.vp.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (firstSize) this.fitView();
    this.render();
  }

  fitView(): void {
    const lv = this.store.level;
    const pts: Vec2[] = [...Object.values(lv.nodes)];
    for (const it of Object.values(lv.items)) pts.push(...itemCorners(it));
    for (const r of Object.values(lv.refImages)) {
      if (!r.visible) continue;
      const hw = (r.widthPx * r.mmPerPx) / 2;
      const hh = (r.heightPx * r.mmPerPx) / 2;
      pts.push({ x: r.x - hw, y: r.y - hh }, { x: r.x + hw, y: r.y + hh });
    }
    if (pts.length === 0) this.vp.fit({ minX: 0, minY: 0, maxX: 6000, maxY: 4500 });
    else this.vp.fit(bbox(pts), Math.min(70, this.vp.width * 0.06), 76, 70);
    this.requestRender();
    this.store.touchView();
  }

  zoomBy(f: number): void {
    this.vp.zoomAt({ x: this.vp.width / 2, y: this.vp.height / 2 }, f);
    this.requestRender();
    this.store.touchView();
  }

  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render(): void {
    const c = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.vp.width);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = THEME.paper;
    c.fillRect(0, 0, this.vp.width, this.vp.height);
    const p = new CanvasPainter(c, this.vp);
    this.hot = [];
    const s = this.store;
    drawPlan(
      p,
      s.level,
      s.derived,
      {
        settings: s.settings,
        selection: s.selection,
        hover: s.hover,
        images: this.images,
        hot: this.hot,
        touch: this.touchMode,
      },
      this.vp.visibleWorld(),
    );
    this.tool.overlay?.(p);
    for (const g of this.guides) {
      if (g.kind === 'marker') p.dot(g.a, 5, { stroke: THEME.accent, width: 2, fill: '#fff' });
      else if (g.b) p.line(g.a, g.b, { stroke: THEME.accent, width: 1, dash: [5, 4], alpha: 0.9 });
    }
    this.drawScaleBar();
    this.drawNorth();
  }

  private drawScaleBar(): void {
    const c = this.ctx;
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const mm = steps.find((m) => m * this.vp.scale >= 70) ?? 50000;
    const w = mm * this.vp.scale;
    const x = 16;
    const y = 34;
    c.save();
    c.fillStyle = 'rgba(247,246,242,0.85)';
    c.fillRect(x - 6, y - 20, w + 12, 30);
    c.fillStyle = THEME.text;
    c.fillRect(x, y, w / 2, 5);
    c.strokeStyle = THEME.text;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, 5);
    c.font = `11px system-ui, -apple-system, sans-serif`;
    c.textAlign = 'center';
    c.fillText('0', x, y - 6);
    c.fillText(formatLength(mm, this.prefs), x + w, y - 6);
    c.restore();
  }

  private drawNorth(): void {
    const c = this.ctx;
    const cx = this.vp.width - 34;
    const cy = 40;
    const rot = (this.store.doc.northAngle * Math.PI) / 180;
    c.save();
    c.translate(cx, cy);
    c.fillStyle = 'rgba(247,246,242,0.85)';
    c.beginPath();
    c.arc(0, 0, 20, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#9aa0a6';
    c.stroke();
    c.rotate(rot);
    c.beginPath();
    c.moveTo(0, -15);
    c.lineTo(7, 7);
    c.lineTo(0, 3);
    c.lineTo(-7, 7);
    c.closePath();
    c.fillStyle = THEME.text;
    c.fill();
    c.fillStyle = THEME.text;
    c.font = '600 10px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('N', 0, -18 + 0);
    c.restore();
  }

  // ---------------- input ----------------
  private info(e: PointerEvent | MouseEvent, type: PointerKind): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return {
      screen,
      world: this.vp.toWorld(screen),
      type,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      button: e.button,
      tol: TOL_PX[type] / this.vp.scale,
    };
  }

  private kindOf(e: PointerEvent): PointerKind {
    return e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
  }

  private clearLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    cv.addEventListener('pointerup', (e) => this.onUp(e));
    cv.addEventListener('pointercancel', (e) => this.onUp(e, true));
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.activeId === null) {
        this.store.setHover(null);
        this.hooks.cursorMoved(null, 'none');
      }
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.lastKind !== 'mouse') return; // touch/pen use long-press
      const i = this.info(e, 'mouse');
      const hit = this.hit(i.world, i.tol);
      if (hit && hit.part !== 'room' && !this.store.isSelected(hit.ref)) this.select([hit.ref]);
      this.contextMenu(i.screen, hit);
    });
    cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Safari trackpad pinch
    let gs = 1;
    cv.addEventListener('gesturestart', ((e: Event & { scale: number }) => {
      e.preventDefault();
      gs = e.scale;
    }) as EventListener);
    cv.addEventListener('gesturechange', ((
      e: Event & { scale: number; clientX: number; clientY: number },
    ) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.vp.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, e.scale / gs);
      gs = e.scale;
      this.requestRender();
      this.store.touchView();
    }) as EventListener);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }

  private onDown(e: PointerEvent): void {
    const type = this.kindOf(e);
    this.lastKind = type;
    if (type === 'pen') this.penUntil = Date.now() + 1000;
    // Palm rejection: while the pencil is in use, single touches are ignored.
    if (type === 'touch' && Date.now() < this.penUntil && this.pointers.size === 0) return;
    this.touchMode = type === 'touch';
    this.canvas.focus({ preventScroll: true });
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    if (this.hooks.numericOpen() && type !== 'mouse') this.hooks.closeNumeric();

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length >= 2) {
      // Two fingers: pinch-zoom / pan. Abort whatever the tool was doing.
      this.clearLongPress();
      if (this.activeId !== null) this.tool.cancel();
      this.activeId = null;
      const [a, b] = touches as unknown as [{ x: number; y: number }, { x: number; y: number }];
      this.gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.suppressUntilUp = true;
      return;
    }
    if (this.pointers.size > 1) return;
    const i = this.info(e, type);
    if (e.button === 1 || (this.spaceDown && e.button === 0)) {
      this.spacePan = i.screen;
      this.activeId = e.pointerId;
      return;
    }
    if (type !== 'mouse') {
      this.longPress = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          this.longPress = null;
          if (this.activeId === null) return;
          this.tool.cancel();
          this.activeId = null;
          this.suppressUntilUp = true;
          const hit = this.hit(i.world, i.tol);
          if (hit && hit.part !== 'room' && !this.store.isSelected(hit.ref)) this.select([hit.ref]);
          navigator.vibrate?.(10);
          this.contextMenu(i.screen, hit);
        }, LONG_PRESS_MS),
      };
    }
    this.activeId = e.pointerId;
    this.tool.down(i);
    this.canvas.style.cursor = this.tool.cursor;
    this.requestRender();
  }

  private onMove(e: PointerEvent): void {
    const type = this.kindOf(e);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = e.clientX;
      ptr.y = e.clientY;
    }
    if (this.gesture) {
      const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
      if (touches.length >= 2) {
        const [a, b] = touches as unknown as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const r = this.canvas.getBoundingClientRect();
        this.vp.panBy(cx - this.gesture.cx, cy - this.gesture.cy);
        if (this.gesture.dist > 0) this.vp.zoomAt({ x: cx - r.left, y: cy - r.top }, d / this.gesture.dist);
        this.gesture = { dist: d, cx, cy };
        this.requestRender();
        this.store.touchView();
      }
      return;
    }
    if (this.longPress && Math.hypot(e.clientX - this.longPress.x, e.clientY - this.longPress.y) > 8)
      this.clearLongPress();
    if (this.suppressUntilUp) return;
    if (type === 'touch' && Date.now() < this.penUntil && this.activeId !== e.pointerId) return;
    const i = this.info(e, type);
    if (this.spacePan && this.activeId === e.pointerId) {
      this.vp.panBy(i.screen.x - this.spacePan.x, i.screen.y - this.spacePan.y);
      this.spacePan = i.screen;
      this.requestRender();
      return;
    }
    const pressed = this.activeId === e.pointerId;
    if (!pressed && this.activeId !== null) return;
    if (!pressed && type !== 'mouse' && type !== 'pen') return; // no hover for fingers
    if (!pressed && e.buttons === 0) this.hooks.cursorMoved(i.world, 'none');
    this.tool.move(i, pressed);
    this.canvas.style.cursor = this.spaceDown ? 'grab' : this.tool.cursor;
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    if (this.gesture) {
      if ([...this.pointers.values()].filter((p) => p.type === 'touch').length < 2) this.gesture = null;
      if (this.pointers.size === 0) this.suppressUntilUp = false;
      return;
    }
    if (this.suppressUntilUp) {
      if (this.pointers.size === 0) this.suppressUntilUp = false;
      return;
    }
    if (this.activeId !== e.pointerId) return;
    this.activeId = null;
    if (this.spacePan) {
      this.spacePan = null;
      return;
    }
    const type = this.kindOf(e);
    const i = this.info(e, type);
    if (cancelled) {
      this.tool.cancel();
      return;
    }
    this.tool.up(i);
    const now = performance.now();
    const lu = this.lastUp;
    if (
      lu &&
      now - lu.t < 350 &&
      Math.hypot(lu.x - i.screen.x, lu.y - i.screen.y) < (type === 'touch' ? 24 : 8)
    ) {
      this.lastUp = null;
      this.tool.dblclick?.(i);
    } else this.lastUp = { t: now, x: i.screen.x, y: i.screen.y };
    this.hooks.toolChanged();
    this.requestRender();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    const lineMode = e.deltaMode === 1;
    const mouseWheel = lineMode || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouseWheel) {
      const dy = lineMode ? e.deltaY * 33 : e.deltaY;
      this.vp.zoomAt(at, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      this.vp.panBy(-e.deltaX, -e.deltaY);
    }
    this.requestRender();
    this.store.touchView();
  }

  /** Keyboard events routed from the app (when no text field has focus). */
  key(e: KeyboardEvent): boolean {
    return this.tool.key?.(e) ?? false;
  }

  /** Canvas-relative centre of the view in world coordinates. */
  viewCenter(): Vec2 {
    return { x: this.vp.cx, y: this.vp.cy };
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  );
}
