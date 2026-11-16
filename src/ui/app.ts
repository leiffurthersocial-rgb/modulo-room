import { html, nothing, render, type TemplateResult } from 'lit-html';
import { buildSampleProject } from '../app/sample';
import type { Store, ToolId } from '../app/store';
import { copyRefs, type Clipboard } from '../commands/commands';
import { Editor, isTyping } from '../editor2d/editor';
import type { Hit } from '../editor2d/hit';
import { SvgPainter, CanvasPainter } from '../editor2d/painter';
import { drawPlan } from '../editor2d/render';
import { OPENING_DEFAULTS, wallUnder } from '../editor2d/tools/place';
import { editItemSize, editOpening, editText, editWallLength, renameRoom } from '../editor2d/tools/edits';
import type { NumericRequest } from '../editor2d/tools/types';
import { Viewport } from '../editor2d/viewport';
import { itemCorners } from '../geometry/collide';
import { bbox } from '../geometry/vec';
import { newId } from '../model/ids';
import { createProject, WALL_THICKNESS_PRESETS } from '../model/project';
import { ProjectFormatError } from '../model/schema';
import { formatLength, type UnitPrefs } from '../model/units';
import type { Level, OpeningKind, Ref, Vec2 } from '../model/types';
import {
  exportProjectFile,
  getBlob,
  importProjectFile,
  putBlob,
  requestPersistence,
  saveProject,
} from '../persistence/db';
import { segmented } from './fields';
import { icons } from './icons';
import { inspector, setUnits, unitsValue, type AppCtx } from './inspector';
import { SHORTCUTS, toolForKey } from './shortcuts';

interface MenuState {
  screen: Vec2;
  world: Vec2;
  hit: Hit | null;
}

const TOOLS: { id: ToolId; label: string; key: string; icon: TemplateResult }[] = [
  { id: 'select', label: 'Select & move', key: 'V', icon: icons.select },
  { id: 'wall', label: 'Draw walls', key: 'W', icon: icons.wall },
  { id: 'room', label: 'Draw room (rectangle)', key: 'B', icon: icons.room },
  { id: 'door', label: 'Door', key: 'D', icon: icons.door },
  { id: 'window', label: 'Window', key: 'N', icon: icons.window },
  { id: 'furniture', label: 'Furniture', key: 'F', icon: icons.furniture },
  { id: 'measure', label: 'Measure / dimension', key: 'M', icon: icons.measure },
  { id: 'text', label: 'Text label', key: 'T', icon: icons.text },
  { id: 'erase', label: 'Erase', key: 'X', icon: icons.erase },
  { id: 'pan', label: 'Pan', key: 'H', icon: icons.pan },
];

export class App implements AppCtx {
  readonly editor: Editor;
  private root: HTMLElement;
  private numeric: NumericRequest | null = null;
  private numericError = '';
  private menu: MenuState | null = null;
  private fileMenu = false;
  private dialog: 'help' | 'about' | null = null;
  private toasts: { id: number; msg: string }[] = [];
  private inspectorOpen = true;
  private saveState: 'saved' | 'saving' | 'error' | 'off' = 'saved';
  private cursor: Vec2 | null = null;
  private snapKind = 'none';
  private clip: Clipboard | null = null;
  private pasteCount = 0;
  private scheduled = 0;
  private saveTimer = 0;
  private persisted = false;

  constructor(
    host: HTMLElement,
    readonly store: Store,
    private opts: { autosave: boolean },
  ) {
    this.root = host;
    this.saveState = opts.autosave ? 'saved' : 'off';
    this.inspectorOpen = window.innerWidth >= 900;
    this.renderNow();
    const canvasHost = host.querySelector<HTMLElement>('.canvas-host');
    if (!canvasHost) throw new Error('canvas host missing');
    this.editor = new Editor(canvasHost, store, {
      openNumeric: (r) => this.openNumeric(r),
      closeNumeric: () => this.closeNumeric(),
      numericOpen: () => this.numeric !== null,
      contextMenu: (screen, hit) => {
        this.menu = { screen, world: this.editor.vp.toWorld(screen), hit };
        this.invalidate();
      },
      toast: (m) => this.toast(m),
      toolChanged: () => this.invalidate(),
      cursorMoved: (w, k) => {
        this.cursor = w;
        this.snapKind = k;
        this.scheduleStatus();
      },
    });
    store.subscribe((reason) => {
      if (reason === 'load') {
        this.loadImages();
        requestAnimationFrame(() => this.editor.fitView());
      }
      if (reason === 'doc' || reason === 'settings' || reason === 'load') this.scheduleSave();
      // Tool switches change overlays: render now so nothing stale covers the plan.
      if (reason === 'tool') this.renderNow();
      else this.invalidate();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('mr:duplicate', () => this.duplicateSelection());
    window.addEventListener('beforeunload', () => {
      if (this.saveTimer) void this.saveNow();
    });
    this.loadImages();
    this.renderNow();
  }

  get prefs(): UnitPrefs {
    const s = this.store.settings;
    return { units: s.units, metricUnit: s.metricUnit };
  }

  // ------------------------------------------------------------ rendering
  invalidate(): void {
    if (this.scheduled) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      this.renderNow();
    });
  }

  private statusTimer = 0;
  private scheduleStatus(): void {
    if (this.statusTimer) return;
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      this.invalidate();
    }, 60);
  }

  renderNow(): void {
    render(this.template(), this.root);
  }

  private template(): TemplateResult {
    const s = this.store;
    return html`<div class=${`app ${this.inspectorOpen ? 'with-inspector' : ''}`}>
      ${this.topbar()}
      <nav class="toolbar" aria-label="Tools">
        ${TOOLS.map(
          (t) =>
            html`<button
              class=${s.tool === t.id ? 'tool on' : 'tool'}
              data-tool=${t.id}
              title=${`${t.label} (${t.key})`}
              aria-label=${t.label}
              aria-pressed=${s.tool === t.id ? 'true' : 'false'}
              @click=${() => this.setTool(t.id)}
            >
              ${t.icon}<span class="tool-key">${t.key}</span>
            </button>`,
        )}
        <span class="sep"></span>
        <button
          class=${s.settings.snap ? 'tool on-soft' : 'tool'}
          title="Snapping (hold Alt to bypass)"
          aria-label="Snapping"
          aria-pressed=${s.settings.snap ? 'true' : 'false'}
          @click=${() => s.updateSettings({ snap: !s.settings.snap })}
        >
          ${icons.magnet}
        </button>
        <button
          class=${s.settings.showGrid ? 'tool on-soft' : 'tool'}
          title="Grid (G)"
          aria-label="Grid"
          aria-pressed=${s.settings.showGrid ? 'true' : 'false'}
          @click=${() => s.updateSettings({ showGrid: !s.settings.showGrid })}
        >
          ${icons.grid}
        </button>
      </nav>
      <main class="stage">
        <div class="canvas-host"></div>
        ${this.toolOptions()} ${this.emptyState()} ${this.actionBar()} ${this.numericPopover()}
        ${this.contextMenuTpl()}
        <div class="zoom-ctl">
          <button title="Zoom out (-)" aria-label="Zoom out" @click=${() => this.editor?.zoomBy(1 / 1.25)}>
            ${icons.zoomOut}
          </button>
          <button title="Zoom to fit (0)" aria-label="Zoom to fit" @click=${() => this.editor?.fitView()}>
            ${icons.fit}
          </button>
          <button title="Zoom in (+)" aria-label="Zoom in" @click=${() => this.editor?.zoomBy(1.25)}>
            ${icons.zoomIn}
          </button>
        </div>
      </main>
      <aside class="inspector" aria-label="Properties">${this.editor ? inspector(this) : nothing}</aside>
      ${this.statusbar()} ${this.dialogTpl()}
      <div class="toasts" role="status" aria-live="polite">
        ${this.toasts.map((t) => html`<div class="toast">${t.msg}</div>`)}
      </div>
    </div>`;
  }

  private topbar(): TemplateResult {
    const s = this.store;
    return html`<header class="topbar">
      <div class="menu-wrap">
        <button
          class="icon-btn"
          aria-label="File menu"
          aria-expanded=${this.fileMenu ? 'true' : 'false'}
          @click=${() => this.toggleFileMenu()}
        >
          ${icons.menu}
        </button>
        ${this.fileMenu ? this.fileMenuTpl() : nothing}
      </div>
      <div class="brand"><strong>Modulo</strong><span>Room</span></div>
      <input
        class="project-name"
        aria-label="Project name"
        .value=${s.doc.name}
        @change=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v) s.dispatch({ type: 'setProject', name: v });
        }}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button
        class="icon-btn"
        title=${`Undo ${s.undoLabel ?? ''} (Ctrl+Z)`}
        aria-label="Undo"
        ?disabled=${!s.canUndo}
        @click=${() => s.undo()}
      >
        ${icons.undo}
      </button>
      <button
        class="icon-btn"
        title=${`Redo ${s.redoLabel ?? ''} (Ctrl+Shift+Z)`}
        aria-label="Redo"
        ?disabled=${!s.canRedo}
        @click=${() => s.redo()}
      >
        ${icons.redo}
      </button>
      <span class="spacer"></span>
      ${segmented(
        [
          { value: 'm', label: 'm' },
          { value: 'cm', label: 'cm' },
          { value: 'mm', label: 'mm' },
          { value: 'ft', label: 'ft-in' },
        ],
        unitsValue(s),
        (v) => setUnits(s, v),
        'Units',
      )}
      <button
        class="icon-btn"
        title="Keyboard shortcuts (?)"
        aria-label="Help"
        @click=${() => this.openDialog('help')}
      >
        ${icons.help}
      </button>
      <button
        class=${this.inspectorOpen ? 'icon-btn on' : 'icon-btn'}
        title="Properties panel"
        aria-label="Toggle properties panel"
        @click=${() => {
          this.inspectorOpen = !this.inspectorOpen;
          this.invalidate();
        }}
      >
        ${icons.panel}
      </button>
    </header>`;
  }

  private fileMenuTpl(): TemplateResult {
    const item = (label: string, run: () => void, hint = '') =>
      html`<button
        role="menuitem"
        @click=${() => {
          this.fileMenu = false;
          run();
          this.invalidate();
        }}
      >
        <span>${label}</span><kbd>${hint}</kbd>
      </button>`;
    return html`<div class="dropdown" role="menu">
      ${item('New project', () => this.newProject())}
      ${item('Open project file…', () => this.openFile(), 'Ctrl+O')}
      ${item('Save project file (.json)', () => void this.saveFile(), 'Ctrl+S')}
      <hr />
      ${item('Export plan as SVG', () => this.exportSvg())}
      ${item('Export plan as PNG', () => void this.exportPng())}
      <hr />
      ${item('Import reference image…', () => this.importReferenceImage())}
      ${item('Load sample flat', () => this.loadSample())}
      <hr />
      ${item('Keyboard shortcuts', () => this.openDialog('help'), '?')}
      ${item('About & credits', () => this.openDialog('about'))}
    </div>`;
  }

  private toolOptions(): TemplateResult | typeof nothing {
    const s = this.store;
    const st = s.settings;
    if (s.tool === 'wall' || s.tool === 'room') {
      return html`<div class="tool-options">
        <span>Thickness</span>
        ${segmented(
          WALL_THICKNESS_PRESETS.map((t) => ({
            value: t as number,
            label: formatLength(t, { units: st.units, metricUnit: 'cm' }),
          })),
          st.wallThickness,
          (v) => s.updateSettings({ wallThickness: v }),
          'Wall thickness',
        )}
        <span class="muted">Height ${formatLength(st.wallHeight, this.prefs)}</span>
      </div>`;
    }
    if (s.tool === 'door') {
      const kinds: OpeningKind[] = ['door', 'double-door', 'sliding-door', 'opening'];
      return html`<div class="tool-options">
        ${segmented(
          kinds.map((k) => ({ value: k, label: OPENING_DEFAULTS[k].label })),
          s.toolOptions.doorKind,
          (v) => s.setToolOptions({ doorKind: v }),
          'Door type',
        )}
      </div>`;
    }
    return nothing;
  }

  private emptyState(): TemplateResult | typeof nothing {
    const lv = this.store.level;
    const empty =
      Object.keys(lv.walls).length === 0 &&
      Object.keys(lv.items).length === 0 &&
      Object.keys(lv.refImages).length === 0;
    if (!empty || this.store.tool !== 'select') return nothing;
    return html`<div class="empty-card" data-testid="empty-state">
      <h1>Plan your room</h1>
      <p>Draw the walls of your real room with exact measurements, then furnish it at real sizes.</p>
      <div class="empty-actions">
        <button class="btn primary" @click=${() => this.setTool('room')}>${icons.room} Draw a room</button>
        <button class="btn" @click=${() => this.setTool('wall')}>${icons.wall} Draw walls</button>
        <button class="btn" @click=${() => this.importReferenceImage()}>
          ${icons.image} Trace a plan or photo
        </button>
        <button class="btn subtle" @click=${() => this.loadSample()}>Open the sample flat</button>
      </div>
      <p class="muted small">Works offline. Your plans stay on this device.</p>
    </div>`;
  }

  private actionBar(): TemplateResult {
    const t = this.editor?.tool;
    const actions = t?.actions?.() ?? [];
    return html`<div class="action-bar">
      <span class="hint" data-testid="hint">${t?.hint() ?? ''}</span>
      ${actions.map(
        (a) =>
          html`<button
            class=${a.primary ? 'btn primary' : a.danger ? 'btn danger' : 'btn'}
            @click=${() => {
              a.run();
              this.invalidate();
            }}
          >
            ${a.label}
          </button>`,
      )}
    </div>`;
  }

  private statusbar(): TemplateResult {
    const s = this.store;
    const c = this.cursor;
    const p = this.prefs;
    const warn = s.derived.warnings.length;
    const save = {
      saved: 'Saved on this device',
      saving: 'Saving…',
      error: 'Not saved!',
      off: 'Autosave off (screenshot mode)',
    }[this.saveState];
    return html`<footer class="statusbar">
      <span>${c ? `x ${formatLength(c.x, p)} · y ${formatLength(c.y, p)}` : ''}</span>
      <span class="muted">${this.snapKind !== 'none' && c ? `snap: ${this.snapKind}` : ''}</span>
      <span class="spacer"></span>
      ${
        warn
          ? html`<button
              class="link warn"
              @click=${() => {
                s.select([]);
                this.inspectorOpen = true;
                this.invalidate();
              }}
            >
              ${icons.warn} ${warn} check${warn > 1 ? 's' : ''}
            </button>`
          : nothing
      }
      <span>${s.selection.length ? `${s.selection.length} selected` : ''}</span>
      <span>${this.editor ? `${Math.round(this.editor.vp.scale * 1000)}%` : ''}</span>
      <span class=${this.saveState === 'error' ? 'warn' : 'muted'} data-testid="save-state">${save}</span>
    </footer>`;
  }

  // ------------------------------------------------------------ numeric popover
  openNumeric(r: NumericRequest): void {
    // Prefill synchronously (a typed first digit replaces the first field) so
    // nothing typed afterwards can be overwritten by a late update.
    const first = r.fields[0];
    const req: NumericRequest =
      r.initialText !== undefined && first
        ? { ...r, fields: [{ ...first, value: r.initialText }, ...r.fields.slice(1)] }
        : r;
    this.numeric = req;
    this.numericError = '';
    this.menu = null;
    this.renderNow();
    const el = this.root.querySelector<HTMLInputElement>('.numeric input, .numeric select');
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      if (r.initialText !== undefined) el.setSelectionRange(el.value.length, el.value.length);
      else el.select();
    }
  }

  closeNumeric(): void {
    if (!this.numeric) return;
    this.numeric = null;
    this.invalidate();
    this.editor.canvas.focus({ preventScroll: true });
  }

  private numericPopover(): TemplateResult | typeof nothing {
    const r = this.numeric;
    if (!r) return nothing;
    const vpW = this.editor?.vp.width ?? 800;
    const vpH = this.editor?.vp.height ?? 600;
    const x = Math.min(Math.max(12, r.at.x + 16), vpW - 290);
    const y = Math.min(Math.max(12, r.at.y + 16), vpH - 60 - r.fields.length * 58);
    const submit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const values: Record<string, string> = {};
      for (const f of r.fields) {
        const el = form.elements.namedItem(f.key) as HTMLInputElement | HTMLSelectElement | null;
        values[f.key] = el?.value ?? '';
      }
      const err = r.onSubmit(values);
      if (typeof err === 'string') {
        this.numericError = err;
        this.invalidate();
        return;
      }
      this.numeric = null;
      this.invalidate();
      this.editor.canvas.focus({ preventScroll: true });
    };
    const cancel = () => {
      r.onCancel?.();
      this.closeNumeric();
    };
    return html`<form
      class="numeric"
      style=${`left:${x}px;top:${y}px`}
      @submit=${submit}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div class="numeric-title">${r.title}</div>
      ${r.fields.map((f) =>
        f.kind === 'select'
          ? html`<label class="field"
              ><span>${f.label}</span
              ><select name=${f.key}>
                ${(f.options ?? []).map((o) => html`<option value=${o.value} ?selected=${o.value === f.value}>${o.label}</option>`)}
              </select></label
            >`
          : html`<label class="field"
              ><span>${f.label}</span
              ><input
                name=${f.key}
                .value=${f.value}
                type="text"
                inputmode=${f.kind === 'text' ? 'text' : 'decimal'}
                autocomplete="off"
                spellcheck="false"
                enterkeyhint="done"
            /></label>`,
      )}
      ${this.numericError ? html`<p class="error" role="alert">${this.numericError}</p>` : nothing}
      <div class="row-actions">
        <button type="button" class="btn" @click=${cancel}>Cancel</button>
        <button type="submit" class="btn primary">${r.submitLabel ?? 'OK'}</button>
      </div>
      ${
        r.fields.some((f) => f.kind === 'length')
          ? html`<p class="muted small">e.g. 3.2 m · 320 cm · 3200 mm · 10' 6"</p>`
          : nothing
      }
    </form>`;
  }

  // ------------------------------------------------------------ context menu
  private contextMenuTpl(): TemplateResult | typeof nothing {
    const m = this.menu;
    if (!m) return nothing;
    const s = this.store;
    const items: { label: string; run: () => void; danger?: boolean }[] = [];
    const h = m.hit;
    const L = s.levelId;
    const at = m.screen;
    const del = (refs: Ref[]) => () => {
      s.dispatch({ type: 'delete', level: L, refs });
      s.select([]);
    };
    if (h) {
      const id = h.ref.id;
      switch (h.ref.coll) {
        case 'walls': {
          const w = s.level.walls[id];
          items.push({ label: 'Edit length…', run: () => editWallLength(this.editor, id) });
          items.push({
            label: 'Split wall here',
            run: () => {
              const wu = wallUnder(s.committedLevel, s.committedDerived.footprints, m.world, 1e6);
              const fp = s.committedDerived.footprints.walls.get(id);
              if (!wu || !fp) return;
              const t = wu.offset / fp.length;
              s.dispatch({
                type: 'splitWall',
                level: L,
                id,
                at: {
                  x: fp.axis[0].x + (fp.axis[1].x - fp.axis[0].x) * t,
                  y: fp.axis[0].y + (fp.axis[1].y - fp.axis[0].y) * t,
                },
              });
            },
          });
          for (const k of ['door', 'window'] as const) {
            items.push({
              label: `Add ${k} here`,
              run: () => {
                const wu = wallUnder(s.committedLevel, s.committedDerived.footprints, m.world, 1e6);
                if (!wu) return;
                const def = OPENING_DEFAULTS[k];
                const oid = newId('o');
                s.dispatch({
                  type: 'add',
                  level: L,
                  coll: 'openings',
                  values: [
                    {
                      id: oid,
                      wallId: id,
                      kind: k,
                      offset: wu.offset,
                      width: def.width,
                      height: def.height,
                      sill: def.sill,
                      hinge: 'a',
                      side: wu.side,
                    },
                  ],
                });
                s.select([{ coll: 'openings', id: oid }]);
              },
            });
          }
          items.push({
            label: w?.lockLength ? 'Unlock length' : 'Lock length',
            run: () =>
              s.dispatch({
                type: 'update',
                level: L,
                coll: 'walls',
                id,
                patch: { lockLength: w?.lockLength ? undefined : true },
              }),
          });
          items.push({ label: 'Delete wall', run: del([h.ref]), danger: true });
          break;
        }
        case 'nodes':
          items.push({ label: 'Delete corner and its walls', run: del([h.ref]), danger: true });
          break;
        case 'items': {
          const it = s.level.items[id];
          items.push({ label: 'Edit size…', run: () => editItemSize(this.editor, id, at) });
          items.push({ label: 'Rotate 90°', run: () => this.editor.kit.select.rotateSelection(90) });
          items.push({ label: 'Duplicate', run: () => this.duplicateSelection() });
          items.push({
            label: it?.locked ? 'Unlock' : 'Lock',
            run: () =>
              s.dispatch({
                type: 'update',
                level: L,
                coll: 'items',
                id,
                patch: { locked: it?.locked ? undefined : true },
              }),
          });
          items.push({ label: 'Delete', run: del(s.selection.length ? s.selection : [h.ref]), danger: true });
          break;
        }
        case 'openings': {
          const o = s.level.openings[id];
          items.push({ label: 'Edit…', run: () => editOpening(this.editor, id, at) });
          if (o && (o.kind === 'door' || o.kind === 'double-door')) {
            items.push({
              label: 'Flip hinge',
              run: () =>
                s.dispatch({
                  type: 'update',
                  level: L,
                  coll: 'openings',
                  id,
                  patch: { hinge: o.hinge === 'a' ? 'b' : 'a' },
                }),
            });
            items.push({
              label: 'Swing other side',
              run: () =>
                s.dispatch({
                  type: 'update',
                  level: L,
                  coll: 'openings',
                  id,
                  patch: { side: o.side === 'l' ? 'r' : 'l' },
                }),
            });
          }
          items.push({ label: 'Delete', run: del([h.ref]), danger: true });
          break;
        }
        case 'rooms':
          items.push({ label: 'Rename…', run: () => renameRoom(this.editor, id) });
          items.push({ label: 'Select room', run: () => s.select([h.ref]) });
          items.push({ label: 'Delete room walls', run: del([h.ref]), danger: true });
          break;
        case 'annotations':
          items.push({ label: 'Edit text…', run: () => editText(this.editor, id, at) });
          items.push({ label: 'Delete', run: del([h.ref]), danger: true });
          break;
        case 'refImages':
          items.push({ label: 'Calibrate scale…', run: () => this.startCalibrate(id) });
          items.push({ label: 'Delete image', run: del([h.ref]), danger: true });
          break;
      }
    }
    if (!h || h.ref.coll === 'rooms') {
      if (this.clip) items.unshift({ label: 'Paste', run: () => this.paste(m.world) });
      items.push({ label: 'Zoom to fit', run: () => this.editor.fitView() });
      items.push({ label: 'Draw a room here', run: () => this.setTool('room') });
    }
    const x = Math.min(m.screen.x, (this.editor?.vp.width ?? 800) - 220);
    const y = Math.min(m.screen.y, (this.editor?.vp.height ?? 600) - items.length * 44 - 16);
    return html`<div class="ctx-backdrop" @pointerdown=${() => this.closeMenu()}></div>
      <div class="ctx-menu" role="menu" style=${`left:${Math.max(8, x)}px;top:${Math.max(8, y)}px`}>
        ${items.map(
          (it) =>
            html`<button
              role="menuitem"
              class=${it.danger ? 'danger' : ''}
              @click=${() => {
                this.closeMenu();
                it.run();
              }}
            >
              ${it.label}
            </button>`,
        )}
      </div>`;
  }

  private closeMenu(): void {
    this.menu = null;
    this.invalidate();
  }

  // ------------------------------------------------------------ dialogs
  private openDialog(d: 'help' | 'about'): void {
    this.dialog = d;
    this.fileMenu = false;
    this.invalidate();
  }

  private dialogTpl(): TemplateResult | typeof nothing {
    if (!this.dialog) return nothing;
    const close = () => {
      this.dialog = null;
      this.invalidate();
    };
    const body =
      this.dialog === 'help'
        ? html`<h2>Keyboard shortcuts & gestures</h2>
            <div class="shortcut-grid">
              ${SHORTCUTS.map(
                (g) =>
                  html`<section>
                    <h3>${g.group}</h3>
                    <dl>
                      ${g.items.map(
                        ([k, d]) =>
                          html`<dt><kbd>${k}</kbd></dt>
                            <dd>${d}</dd>`,
                      )}
                    </dl>
                  </section>`,
              )}
            </div>`
        : html`<h2>About Modulo: Room</h2>
            <p>
              A local-first room planner. Everything runs in your browser; projects and images are stored only
              on this device.
            </p>
            <h3>Credits</h3>
            <ul>
              <li>Three.js (MIT), lit-html (BSD-3-Clause), idb (ISC), earcut (ISC), Vite (MIT).</li>
              <li>
                Furniture in this version is drawn from simple boxes (greybox). Real models and textures will
                be credited here.
              </li>
            </ul>`;
    return html`<div class="dialog-backdrop" @click=${close}></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        @keydown=${(e: KeyboardEvent) => e.key === 'Escape' && close()}
      >
        <button class="icon-btn close" aria-label="Close" @click=${close}>${icons.close}</button>
        ${body}
      </div>`;
  }

  // ------------------------------------------------------------ actions
  setTool(t: ToolId): void {
    this.store.setTool(t);
    if (t === 'furniture') this.inspectorOpen = true;
    this.invalidate();
  }

  toast(msg: string): void {
    const id = Date.now() + Math.random();
    this.toasts = [...this.toasts.slice(-2), { id, msg }];
    this.invalidate();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.invalidate();
    }, 3200);
  }

  private toggleFileMenu(): void {
    this.fileMenu = !this.fileMenu;
    this.invalidate();
  }

  private newProject(): void {
    if (
      this.store.canUndo &&
      !confirm('Start a new project? The current one stays saved on this device until you replace it.')
    )
      return;
    this.store.load(createProject());
    this.toast('New project');
  }

  loadSample(): void {
    this.store.load(buildSampleProject());
    this.toast('Sample flat loaded');
  }

  private download(name: string, data: Blob): void {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private safeName(): string {
    return (
      this.store.doc.name
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'room'
    );
  }

  async saveFile(): Promise<void> {
    const text = await exportProjectFile(this.store.committed);
    this.download(`${this.safeName()}.modulo-room.json`, new Blob([text], { type: 'application/json' }));
  }

  openFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const p = await importProjectFile(await f.text());
        this.store.load(p);
        this.toast(`Opened “${p.name}”`);
      } catch (e) {
        this.toast(e instanceof ProjectFormatError ? e.message : 'Could not open that file.');
      }
    };
    input.click();
  }

  private contentBox(lv: Level) {
    const pts: Vec2[] = [];
    const d = this.store.derived;
    for (const fp of d.footprints.walls.values()) pts.push(...fp.poly);
    for (const it of Object.values(lv.items)) pts.push(...itemCorners(it));
    for (const a of Object.values(lv.annotations)) pts.push(...(a.kind === 'text' ? [a] : [a.a, a.b]));
    if (!pts.length) return null;
    const b = bbox(pts);
    const m = 600;
    return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
  }

  exportSvg(): void {
    const s = this.store;
    const box = this.contentBox(s.level);
    if (!box) return this.toast('Nothing to export yet');
    const p = new SvgPainter(0.08);
    drawPlan(p, s.level, s.derived, { settings: s.settings, selection: [], hover: null, export: true }, box);
    this.download(
      `${this.safeName()}-plan.svg`,
      new Blob([p.toSvg(box, s.doc.name)], { type: 'image/svg+xml' }),
    );
  }

  async exportPng(): Promise<void> {
    const s = this.store;
    const box = this.contentBox(s.level);
    if (!box) return this.toast('Nothing to export yet');
    const W = 2400;
    const H = Math.round((W * (box.maxY - box.minY)) / (box.maxX - box.minX));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const vp = new Viewport();
    vp.width = W;
    vp.height = H;
    vp.fit(box, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    drawPlan(
      new CanvasPainter(ctx, vp),
      s.level,
      s.derived,
      {
        settings: { ...s.settings, showGrid: false },
        selection: [],
        hover: null,
        images: this.editor.images,
      },
      box,
    );
    ctx.fillStyle = '#262a30';
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(s.doc.name, 24, H - 24);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) this.download(`${this.safeName()}-plan.png`, blob);
  }

  importReferenceImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f);
        const key = newId('blob');
        await putBlob(key, f);
        this.editor.images.set(key, bmp);
        const vis = this.editor.vp.visibleWorld();
        const mmPerPx = ((vis.maxX - vis.minX) * 0.7) / bmp.width;
        const id = newId('img');
        const c = this.editor.viewCenter();
        const s = this.store;
        s.dispatch({
          type: 'add',
          level: s.levelId,
          coll: 'refImages',
          values: [
            {
              id,
              blobKey: key,
              name: f.name,
              x: c.x,
              y: c.y,
              widthPx: bmp.width,
              heightPx: bmp.height,
              mmPerPx,
              rotation: 0,
              opacity: 0.55,
              locked: false,
              visible: true,
            },
          ],
        });
        s.select([{ coll: 'refImages', id }]);
        this.startCalibrate(id);
      } catch {
        this.toast('Could not read that image.');
      }
    };
    input.click();
  }

  startCalibrate(imageId: string): void {
    this.editor.kit.calibrate.imageId = imageId;
    this.store.setTool('calibrate');
    this.toast('Click two points on the image whose real distance you know');
  }

  private loadImages(): void {
    for (const lv of this.store.doc.levels) {
      for (const im of Object.values(lv.refImages)) {
        if (this.editor?.images.has(im.blobKey)) continue;
        void getBlob(im.blobKey).then(async (b) => {
          if (!b) return;
          this.editor.images.set(im.blobKey, await createImageBitmap(b));
          this.editor.requestRender();
        });
      }
    }
  }

  // ------------------------------------------------------------ clipboard
  copy(): void {
    const s = this.store;
    if (!s.selection.length) return;
    this.clip = copyRefs(s.committed, s.levelId, s.selection);
    this.pasteCount = 0;
    this.toast('Copied');
  }

  paste(at?: Vec2): void {
    const s = this.store;
    if (!this.clip) return;
    const before = new Set([
      ...Object.keys(s.committedLevel.items),
      ...Object.keys(s.committedLevel.walls),
      ...Object.keys(s.committedLevel.annotations),
    ]);
    this.pasteCount++;
    let dx = 300 * this.pasteCount;
    let dy = 300 * this.pasteCount;
    if (at) {
      const pts = [
        ...this.clip.nodes,
        ...this.clip.items,
        ...this.clip.annotations.flatMap((a) => (a.kind === 'text' ? [a] : [a.a, a.b])),
      ];
      if (pts.length) {
        const b = bbox(pts);
        dx = at.x - (b.minX + b.maxX) / 2;
        dy = at.y - (b.minY + b.maxY) / 2;
      }
    }
    s.dispatch({ type: 'paste', level: s.levelId, clip: this.clip, dx, dy });
    const lv = s.committedLevel;
    const added: Ref[] = [
      ...Object.keys(lv.items)
        .filter((k) => !before.has(k))
        .map((id) => ({ coll: 'items' as const, id })),
      ...Object.keys(lv.walls)
        .filter((k) => !before.has(k))
        .map((id) => ({ coll: 'walls' as const, id })),
      ...Object.keys(lv.annotations)
        .filter((k) => !before.has(k))
        .map((id) => ({ coll: 'annotations' as const, id })),
    ];
    s.select(added);
  }

  duplicateSelection(): void {
    const keep = this.clip;
    const s = this.store;
    if (!s.selection.length) return;
    this.clip = copyRefs(s.committed, s.levelId, s.selection);
    this.pasteCount = 0;
    this.paste();
    this.clip = keep ?? this.clip;
  }

  private selectAll(): void {
    const lv = this.store.level;
    this.store.select([
      ...Object.keys(lv.walls).map((id) => ({ coll: 'walls' as const, id })),
      ...Object.keys(lv.items).map((id) => ({ coll: 'items' as const, id })),
      ...Object.keys(lv.annotations).map((id) => ({ coll: 'annotations' as const, id })),
    ]);
  }

  // ------------------------------------------------------------ keyboard
  private onKey(e: KeyboardEvent): void {
    if (isTyping(e)) return;
    if (this.numeric) return;
    if (this.dialog) {
      if (e.key === 'Escape') {
        this.dialog = null;
        this.invalidate();
      }
      return;
    }
    if (this.menu && e.key === 'Escape') return this.closeMenu();
    const mod = e.metaKey || e.ctrlKey;
    const s = this.store;
    const k = e.key.toLowerCase();
    if (mod) {
      const handled = (() => {
        if (k === 'z' && !e.shiftKey) s.undo();
        else if ((k === 'z' && e.shiftKey) || k === 'y') s.redo();
        else if (k === 'c') this.copy();
        else if (k === 'x') {
          this.copy();
          s.dispatch({ type: 'delete', level: s.levelId, refs: s.selection });
        } else if (k === 'v') this.paste();
        else if (k === 'd') this.duplicateSelection();
        else if (k === 'a') this.selectAll();
        else if (k === 's') void this.saveFile();
        else if (k === 'o') this.openFile();
        else return false;
        return true;
      })();
      if (handled) e.preventDefault();
      return;
    }
    if (this.editor.key(e)) {
      e.preventDefault();
      this.invalidate();
      return;
    }
    if (e.altKey) return;
    if (e.key === '?') return this.openDialog('help');
    if (e.key === '0') return this.editor.fitView();
    if (e.key === '+' || e.key === '=') return this.editor.zoomBy(1.25);
    if (e.key === '-') return this.editor.zoomBy(1 / 1.25);
    if (k === 'g') return s.updateSettings({ showGrid: !s.settings.showGrid });
    const t = toolForKey(k);
    if (t) {
      e.preventDefault();
      this.setTool(t);
    }
  }

  // ------------------------------------------------------------ autosave
  private scheduleSave(): void {
    if (!this.opts.autosave) return;
    this.saveState = 'saving';
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 500);
  }

  private async saveNow(): Promise<void> {
    this.saveTimer = 0;
    try {
      await saveProject({ ...this.store.committed, updatedAt: new Date().toISOString() });
      this.saveState = 'saved';
      if (!this.persisted) this.persisted = await requestPersistence();
    } catch {
      this.saveState = 'error';
    }
    this.invalidate();
  }
}
