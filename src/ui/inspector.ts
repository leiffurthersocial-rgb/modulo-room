import { html, nothing, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import type { Store } from '../app/store';
import { CATALOG, CATEGORIES, catalogEntry, partFootprint, type CatalogEntry } from '../catalog/catalog';
import { WALL_THICKNESS_PRESETS } from '../model/project';
import { formatArea, formatDimsCompact, formatLength, type UnitPrefs } from '../model/units';
import type { Item, OpeningKind, Ref } from '../model/types';
import { dist } from '../geometry/vec';
import { SvgPainter } from '../editor2d/painter';
import { OPENING_DEFAULTS } from '../editor2d/tools/place';
import type { Editor } from '../editor2d/editor';
import { lengthField, numberField, segmented, selectField, textField, toggle } from './fields';
import { icons } from './icons';

export interface AppCtx {
  store: Store;
  editor: Editor;
  prefs: UnitPrefs;
  invalidate(): void;
  toast(msg: string): void;
  startCalibrate(imageId: string): void;
  importReferenceImage(): void;
  duplicateSelection(): void;
  panelTab: 'props' | 'furniture';
  setPanelTab(t: 'props' | 'furniture'): void;
}

const unitOptions = [
  { value: 'm', label: 'm' },
  { value: 'cm', label: 'cm' },
  { value: 'mm', label: 'mm' },
  { value: 'ft', label: 'ft-in' },
];

export function unitsValue(s: Store): string {
  return s.settings.units === 'imperial' ? 'ft' : s.settings.metricUnit;
}

export function setUnits(s: Store, v: string): void {
  if (v === 'ft') s.updateSettings({ units: 'imperial' });
  else s.updateSettings({ units: 'metric', metricUnit: v as 'm' | 'cm' | 'mm' });
}

// ---------------------------------------------------------------- catalog
const thumbCache = new Map<string, string>();

/** Top-view thumbnail of a catalog item, drawn with the same plan renderer parts. */
function thumb(e: CatalogEntry): string {
  const hit = thumbCache.get(e.id);
  if (hit) return hit;
  const size = Math.max(e.dims.width, e.dims.depth);
  const p = new SvgPainter(60 / size);
  const W = e.dims.width;
  const D = e.dims.depth;
  for (const part of [...e.parts].sort((a, b) => a[6] - b[6])) {
    const pts = partFootprint(part, W, D).map((q) => ({ x: q.x + W / 2, y: q.y + D / 2 }));
    p.poly(pts, { fill: e.color, stroke: '#4c525b', width: 0.8 });
  }
  const pad = size * 0.06;
  const s = p
    .toSvg({ minX: -pad, minY: -pad, maxX: W + pad, maxY: D + pad }, e.name)
    .replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%" height="100%"')
    .replace('fill="#ffffff"', 'fill="none"');
  thumbCache.set(e.id, s);
  return s;
}

export const CATALOG_MIME = 'application/x-modulo-catalog';

function card(ctx: AppCtx, e: CatalogEntry): TemplateResult {
  const s = ctx.store;
  const p = ctx.prefs;
  const on = s.toolOptions.catalogId === e.id && s.tool === 'furniture';
  return html`<button
    class=${on ? 'cat-item on' : 'cat-item'}
    data-catalog-id=${e.id}
    draggable="true"
    title=${`${e.name}\n${formatLength(e.dims.width, p)} × ${formatLength(e.dims.depth, p)} × ${formatLength(e.dims.height, p)} high\nTap, then tap the plan — or drag it onto the plan`}
    @dragstart=${(ev: DragEvent) => {
      ev.dataTransfer?.setData(CATALOG_MIME, e.id);
      ev.dataTransfer?.setData('text/plain', e.name);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    }}
    @click=${() => {
      s.setToolOptions({ catalogId: e.id });
      s.setTool('furniture');
    }}
  >
    <span class="thumb">${unsafeSVG(thumb(e))}</span>
    <span class="cat-name">${e.name}</span>
    <span class="cat-dims">${formatDimsCompact(e.dims.width, e.dims.depth, p)}</span>
  </button>`;
}

export function catalogPanel(ctx: AppCtx): TemplateResult {
  const s = ctx.store;
  const o = s.toolOptions;
  const q = o.catalogQuery.trim().toLowerCase();
  const matches = (e: CatalogEntry) =>
    !q || e.name.toLowerCase().includes(q) || e.category.includes(q) || e.tags.some((t) => t.includes(q));
  const list = CATALOG.filter(
    (e) => (o.catalogCategory === 'all' || e.category === o.catalogCategory) && matches(e),
  );
  const counts = new Map<string, number>();
  for (const e of CATALOG) if (matches(e)) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const recent = s.recent.map((id) => catalogEntry(id)).filter((e): e is CatalogEntry => !!e);
  const grouped = o.catalogCategory === 'all' && !q;
  const placing = s.tool === 'furniture' ? catalogEntry(o.catalogId) : undefined;
  return html`<section class="panel catalog">
    <div class="search-wrap">
      ${icons.search}
      <input
        class="search"
        type="search"
        placeholder=${`Search ${CATALOG.length} items…`}
        aria-label="Search furniture"
        .value=${o.catalogQuery}
        @input=${(e: Event) => s.setToolOptions({ catalogQuery: (e.target as HTMLInputElement).value })}
      />
    </div>
    <div class="chips" role="tablist" aria-label="Categories">
      ${[{ id: 'all', name: 'All' }, ...CATEGORIES].map((c) => {
        const n = c.id === 'all' ? [...counts.values()].reduce((a, b) => a + b, 0) : (counts.get(c.id) ?? 0);
        if (c.id !== 'all' && n === 0) return nothing;
        return html`<button
          role="tab"
          aria-selected=${o.catalogCategory === c.id ? 'true' : 'false'}
          class=${o.catalogCategory === c.id ? 'chip on' : 'chip'}
          @click=${() => s.setToolOptions({ catalogCategory: c.id })}
        >
          ${c.name} <span class="count">${n}</span>
        </button>`;
      })}
    </div>
    ${
      placing
        ? html`<div class="placing">
            <span>Placing <strong>${placing.name}</strong> — tap the plan · R rotates</span>
            <button class="btn" @click=${() => s.setTool('select')}>Done</button>
          </div>`
        : html`<p class="muted small hint-line">
            Tap an item, then tap the plan — or drag it onto the plan.
          </p>`
    }
    ${
      recent.length && grouped
        ? html`<h3>Recently used</h3>
            <div class="catalog-grid">${recent.slice(0, 4).map((e) => card(ctx, e))}</div>`
        : nothing
    }
    ${
      grouped
        ? CATEGORIES.map((c) => {
            const items = CATALOG.filter((e) => e.category === c.id);
            if (!items.length) return nothing;
            return html`<h3 class="cat-head">${c.name} <span class="muted">${items.length}</span></h3>
              <div class="catalog-grid">${items.map((e) => card(ctx, e))}</div>`;
          })
        : html`<div class="catalog-grid">${list.map((e) => card(ctx, e))}</div>`
    }
    ${list.length === 0 ? html`<p class="muted">Nothing matches “${o.catalogQuery}”.</p>` : nothing}
  </section>`;
}

// ---------------------------------------------------------------- inspector
export function inspector(ctx: AppCtx): TemplateResult {
  const s = ctx.store;
  const tab = s.tool === 'furniture' ? 'furniture' : ctx.panelTab;
  const tabs = html`<div class="panel-tabs" role="tablist" aria-label="Side panel">
    <button
      role="tab"
      aria-selected=${tab === 'props' ? 'true' : 'false'}
      class=${tab === 'props' ? 'on' : ''}
      @click=${() => ctx.setPanelTab('props')}
    >
      ${icons.sliders} Properties
    </button>
    <button
      role="tab"
      data-testid="tab-furniture"
      aria-selected=${tab === 'furniture' ? 'true' : 'false'}
      class=${tab === 'furniture' ? 'on' : ''}
      @click=${() => ctx.setPanelTab('furniture')}
    >
      ${icons.furniture} Furniture <span class="count">${CATALOG.length}</span>
    </button>
  </div>`;
  return html`${tabs}${tab === 'furniture' ? catalogPanel(ctx) : propertiesPanel(ctx)}`;
}

function propertiesPanel(ctx: AppCtx): TemplateResult {
  const s = ctx.store;
  const sel = s.selection;
  if (sel.length === 0) return projectPanel(ctx);
  if (sel.length > 1) return multiPanel(ctx, sel);
  const r = sel[0] as Ref;
  switch (r.coll) {
    case 'walls':
      return wallPanel(ctx, r.id);
    case 'nodes':
      return nodePanel(ctx, r.id);
    case 'openings':
      return openingPanel(ctx, r.id);
    case 'items':
      return itemPanel(ctx, r.id);
    case 'rooms':
      return roomPanel(ctx, r.id);
    case 'annotations':
      return annotationPanel(ctx, r.id);
    case 'refImages':
      return refImagePanel(ctx, r.id);
    default:
      return projectPanel(ctx);
  }
}

function header(title: string, sub?: string): TemplateResult {
  return html`<header class="panel-head">
    <h2>${title}</h2>
    ${sub ? html`<p class="muted">${sub}</p>` : nothing}
  </header>`;
}

function dangerRow(ctx: AppCtx, label = 'Delete'): TemplateResult {
  const s = ctx.store;
  const canDup = s.selection.some(
    (r) => r.coll === 'items' || r.coll === 'walls' || r.coll === 'annotations',
  );
  return html`<div class="row-actions">
    ${canDup ? html`<button class="btn" @click=${() => ctx.duplicateSelection()}>${icons.copy} Duplicate</button>` : nothing}
    <button
      class="btn danger"
      @click=${() => {
        s.dispatch({ type: 'delete', level: s.levelId, refs: s.selection });
        s.select([]);
      }}
    >
      ${icons.trash} ${label}
    </button>
  </div>`;
}

function upd(ctx: AppCtx, coll: Ref['coll'], id: string, patch: Record<string, unknown>): void {
  ctx.store.dispatch({ type: 'update', level: ctx.store.levelId, coll, id, patch });
}

function projectPanel(ctx: AppCtx): TemplateResult {
  const s = ctx.store;
  const st = s.settings;
  const d = s.derived;
  const total = d.rooms.reduce((a, r) => a + r.area, 0);
  return html`<section class="panel">
    ${header('Project')}
    ${textField('Name', s.doc.name, (v) => v.trim() && s.dispatch({ type: 'setProject', name: v.trim() }), 'project-name')}
    <div class="field">
      <span>Units</span>${segmented(unitOptions, unitsValue(s), (v) => setUnits(s, v), 'Display units')}
    </div>
    <div class="field">
      <span>Wall thickness</span>
      ${segmented(
        WALL_THICKNESS_PRESETS.map((t) => ({
          value: t as number,
          label: formatLength(t, { units: st.units, metricUnit: st.units === 'metric' ? 'cm' : 'm' }),
        })),
        st.wallThickness,
        (v) => s.updateSettings({ wallThickness: v }),
        'Wall thickness',
      )}
    </div>
    ${lengthField('Custom thickness', st.wallThickness, ctx.prefs, (v) => s.updateSettings({ wallThickness: v }), { min: 20 })}
    ${lengthField('Wall height', st.wallHeight, ctx.prefs, (v) => s.updateSettings({ wallHeight: v }), { min: 500 })}
    <h3>Snapping</h3>
    ${toggle('Snap to corners, walls, angles and grid', st.snap, (v) => s.updateSettings({ snap: v }))}
    <div class="field">
      <span>Angle step</span>
      ${segmented(
        [
          { value: 15, label: '15°' },
          { value: 45, label: '45°' },
          { value: 90, label: '90°' },
        ],
        st.angleStep,
        (v) => s.updateSettings({ angleStep: v as 15 | 45 | 90 }),
        'Angle step',
      )}
    </div>
    ${lengthField('Grid size', st.gridSize, ctx.prefs, (v) => s.updateSettings({ gridSize: v }), { min: 10 })}
    <h3>Display</h3>
    ${toggle('Grid', st.showGrid, (v) => s.updateSettings({ showGrid: v }))}
    ${toggle('Dimensions', st.showDimensions, (v) => s.updateSettings({ showDimensions: v }))}
    ${toggle('Room names and furniture labels', st.showLabels, (v) => s.updateSettings({ showLabels: v }))}
    ${toggle('Clearance zones (door swings, walkways)', st.showClearance, (v) => s.updateSettings({ showClearance: v }))}
    ${lengthField('Minimum walkway', st.walkwayMin, ctx.prefs, (v) => s.updateSettings({ walkwayMin: v }), { min: 300 })}
    ${numberField('North (° clockwise)', s.doc.northAngle, (v) => s.dispatch({ type: 'setProject', northAngle: ((v % 360) + 360) % 360 }), { step: 5, suffix: '°' })}
    <h3>Rooms <span class="muted">${formatArea(total, ctx.prefs)} total</span></h3>
    <ul class="room-list">
      ${d.rooms.map(
        (r) =>
          html`<li>
            <button class="link" @click=${() => s.select([{ coll: 'rooms', id: r.id }])}>
              ${r.meta?.name ?? 'Room'}
            </button>
            <span class="muted">${formatArea(r.area, ctx.prefs)}</span>
          </li>`,
      )}
      ${d.rooms.length === 0 ? html`<li class="muted">No closed rooms yet.</li>` : nothing}
    </ul>
    ${warningsList(ctx)}
    <h3>Reference image</h3>
    <button class="btn" @click=${() => ctx.importReferenceImage()}>
      ${icons.image} Import plan or photo…
    </button>
    <p class="muted small">Images stay on this device. Nothing is uploaded.</p>
  </section>`;
}

export function warningsList(ctx: AppCtx): TemplateResult {
  const w = ctx.store.derived.warnings;
  if (!w.length)
    return html`<h3>Checks</h3>
      <p class="muted small ok">✓ No overlaps, blocked doors or tight walkways.</p>`;
  return html`<h3>Checks <span class="badge warn">${w.length}</span></h3>
    <ul class="warn-list" data-testid="warnings">
      ${w.map(
        (x) =>
          html`<li>
            <button
              class="link"
              @click=${() => ctx.store.select(x.refs.filter((r) => r.coll === 'items').slice(0, 1))}
            >
              ${icons.warn} ${x.message}
            </button>
          </li>`,
      )}
    </ul>`;
}

function multiPanel(ctx: AppCtx, sel: Ref[]): TemplateResult {
  const counts = new Map<string, number>();
  for (const r of sel) counts.set(r.coll, (counts.get(r.coll) ?? 0) + 1);
  const names: Record<string, string> = {
    walls: 'walls',
    items: 'items',
    openings: 'doors/windows',
    annotations: 'labels',
    nodes: 'corners',
    rooms: 'rooms',
    refImages: 'images',
  };
  return html`<section class="panel">
    ${header(`${sel.length} selected`, [...counts].map(([k, n]) => `${n} ${names[k] ?? k}`).join(', '))}
    ${
      sel.some((r) => r.coll === 'items')
        ? html`<button class="btn" @click=${() => ctx.editor.kit.select.rotateSelection(90)}>
            ${icons.rotate} Rotate items 90°
          </button>`
        : nothing
    }
    ${dangerRow(ctx)}
  </section>`;
}

function wallPanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const lv = s.level;
  const w = lv.walls[id];
  const fp = s.derived.footprints.walls.get(id);
  if (!w || !fp) return projectPanel(ctx);
  const len = fp.length;
  const left = dist(...fp.left);
  const right = dist(...fp.right);
  return html`<section class="panel">
    ${header('Wall', `Faces: ${formatLength(left, ctx.prefs)} / ${formatLength(right, ctx.prefs)}`)}
    ${lengthField(
      'Length (centreline)',
      len,
      ctx.prefs,
      (v) => s.dispatch({ type: 'setWallLength', level: s.levelId, id, length: v, anchor: 'a' }),
      {
        min: 10,
        disabled: !!w.lockLength,
        testId: 'wall-length',
      },
    )}
    ${toggle('Lock length', !!w.lockLength, (v) => upd(ctx, 'walls', id, { lockLength: v || undefined }))}
    <div class="field">
      <span>Thickness</span>
      ${segmented(
        WALL_THICKNESS_PRESETS.map((t) => ({
          value: t as number,
          label: formatLength(t, { units: s.settings.units, metricUnit: 'cm' }),
        })),
        w.thickness,
        (v) => upd(ctx, 'walls', id, { thickness: v }),
        'Wall thickness',
      )}
    </div>
    ${lengthField('Custom thickness', w.thickness, ctx.prefs, (v) => upd(ctx, 'walls', id, { thickness: v }), { min: 20 })}
    ${lengthField('Height at start', w.height, ctx.prefs, (v) => upd(ctx, 'walls', id, { height: v }), { min: 100 })}
    ${lengthField('Height at end (sloped)', w.heightEnd ?? w.height, ctx.prefs, (v) => upd(ctx, 'walls', id, { heightEnd: Math.abs(v - w.height) < 0.5 ? undefined : v }), { min: 100 })}
    <div class="row-actions">
      <button
        class="btn"
        @click=${() => {
          const a = lv.nodes[w.a];
          const b = lv.nodes[w.b];
          if (a && b)
            s.dispatch({
              type: 'splitWall',
              level: s.levelId,
              id,
              at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            });
        }}
      >
        Split in half
      </button>
    </div>
    ${dangerRow(ctx)}
  </section>`;
}

function nodePanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const n = s.level.nodes[id];
  if (!n) return projectPanel(ctx);
  return html`<section class="panel">
    ${header('Corner')}
    ${lengthField('X', n.x, ctx.prefs, (v) => s.dispatch({ type: 'setNodePos', level: s.levelId, id, x: v, y: n.y }))}
    ${lengthField('Y', n.y, ctx.prefs, (v) => s.dispatch({ type: 'setNodePos', level: s.levelId, id, x: n.x, y: v }))}
    ${dangerRow(ctx, 'Delete corner and its walls')}
  </section>`;
}

function openingPanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const o = s.level.openings[id];
  if (!o) return projectPanel(ctx);
  const fp = s.derived.footprints.walls.get(o.wallId);
  const L = fp?.length ?? 0;
  const isDoor = o.kind === 'door' || o.kind === 'double-door';
  return html`<section class="panel">
    ${header(OPENING_DEFAULTS[o.kind].label)}
    ${selectField(
      'Type',
      o.kind,
      (Object.keys(OPENING_DEFAULTS) as OpeningKind[]).map((k) => ({
        value: k,
        label: OPENING_DEFAULTS[k].label,
      })),
      (v) =>
        upd(ctx, 'openings', id, { kind: v, ...(v === 'window' ? { sill: o.sill || 900 } : { sill: 0 }) }),
    )}
    ${lengthField('Width', o.width, ctx.prefs, (v) => upd(ctx, 'openings', id, { width: v }), { min: 200, testId: 'opening-width' })}
    ${lengthField('Height', o.height, ctx.prefs, (v) => upd(ctx, 'openings', id, { height: v }), { min: 200 })}
    ${lengthField('Sill height', o.sill, ctx.prefs, (v) => upd(ctx, 'openings', id, { sill: v }), { min: 0 })}
    ${lengthField('From wall start (to edge)', o.offset - o.width / 2, ctx.prefs, (v) => upd(ctx, 'openings', id, { offset: v + o.width / 2 }), { min: 0 })}
    <p class="muted small">Wall length ${formatLength(L, ctx.prefs)}</p>
    ${
      isDoor
        ? html`<div class="row-actions">
            <button
              class="btn"
              @click=${() => upd(ctx, 'openings', id, { hinge: o.hinge === 'a' ? 'b' : 'a' })}
            >
              Flip hinge
            </button>
            <button
              class="btn"
              @click=${() => upd(ctx, 'openings', id, { side: o.side === 'l' ? 'r' : 'l' })}
            >
              Swing other side
            </button>
          </div>`
        : nothing
    }
    ${dangerRow(ctx)}
  </section>`;
}

function itemPanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const it: Item | undefined = s.level.items[id];
  if (!it) return projectPanel(ctx);
  const e = catalogEntry(it.catalogId);
  const p = ctx.prefs;
  const warns = s.derived.warnings.filter((w) => w.refs.some((r) => r.id === id));
  return html`<section class="panel">
    ${header(it.name ?? e?.name ?? 'Item', e ? `${CATEGORIES.find((c) => c.id === e.category)?.name ?? e.category}` : undefined)}
    ${textField('Label', it.name ?? '', (v) => upd(ctx, 'items', id, { name: v.trim() || undefined }))}
    <div class="grid2">
      ${lengthField('Width', it.width, p, (v) => upd(ctx, 'items', id, { width: v }), { min: 10, testId: 'item-width' })}
      ${lengthField('Depth', it.depth, p, (v) => upd(ctx, 'items', id, { depth: v }), { min: 10, testId: 'item-depth' })}
      ${lengthField('Height', it.height, p, (v) => upd(ctx, 'items', id, { height: v }), { min: 1 })}
      ${lengthField('Elevation', it.elevation, p, (v) => upd(ctx, 'items', id, { elevation: v }), { min: 0 })}
      ${lengthField('X', it.x, p, (v) => upd(ctx, 'items', id, { x: v }))}
      ${lengthField('Y', it.y, p, (v) => upd(ctx, 'items', id, { y: v }))}
    </div>
    ${numberField('Rotation', it.rotation, (v) => upd(ctx, 'items', id, { rotation: ((v % 360) + 360) % 360 }), { step: 15, suffix: '°' })}
    <label class="field"
      ><span>Colour</span
      ><input
        type="color"
        .value=${it.color ?? e?.color ?? '#cccccc'}
        @change=${(ev: Event) => upd(ctx, 'items', id, { color: (ev.target as HTMLInputElement).value })}
    /></label>
    ${toggle('Locked (cannot be moved)', !!it.locked, (v) => upd(ctx, 'items', id, { locked: v || undefined }))}
    ${toggle('Mirrored', !!it.mirrored, (v) => upd(ctx, 'items', id, { mirrored: v || undefined }))}
    ${
      e
        ? html`<button
            class="btn subtle"
            @click=${() => upd(ctx, 'items', id, { width: e.dims.width, depth: e.dims.depth, height: e.dims.height })}
          >
            Reset to catalog size
          </button>`
        : nothing
    }
    ${
      warns.length
        ? html`<ul class="warn-list">
            ${warns.map((w) => html`<li>${icons.warn} ${w.message}</li>`)}
          </ul>`
        : nothing
    }
    ${dangerRow(ctx)}
  </section>`;
}

function roomPanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const r = s.derived.rooms.find((x) => x.id === id);
  if (!r?.meta) return projectPanel(ctx);
  const meta = r.meta;
  let perim = 0;
  for (let k = 0; k < r.polygon.length; k++)
    perim += dist(r.polygon[k] as never, r.polygon[(k + 1) % r.polygon.length] as never);
  const lvHeight = meta.ceilingHeight ?? s.settings.wallHeight;
  return html`<section class="panel">
    ${header(meta.name, `${formatArea(r.area, ctx.prefs)} · perimeter ${formatLength(perim, ctx.prefs)}`)}
    ${textField('Name', meta.name, (v) => v.trim() && upd(ctx, 'rooms', id, { name: v.trim() }), 'room-name')}
    <label class="field"
      ><span>Floor colour</span
      ><input
        type="color"
        .value=${meta.color ?? '#efe9dd'}
        @change=${(ev: Event) => upd(ctx, 'rooms', id, { color: (ev.target as HTMLInputElement).value })}
    /></label>
    ${lengthField('Ceiling height', lvHeight, ctx.prefs, (v) => upd(ctx, 'rooms', id, { ceilingHeight: v }), { min: 1000 })}
    <p class="muted small">
      Wall area (excl. openings): about ${formatArea(perim * lvHeight, { ...ctx.prefs })}
    </p>
    <p class="muted small">Tap a dimension inside the room to set an exact size.</p>
    <div class="row-actions">
      <button
        class="btn danger"
        @click=${() => {
          s.dispatch({ type: 'delete', level: s.levelId, refs: [{ coll: 'rooms', id }] });
          s.select([]);
        }}
      >
        ${icons.trash} Delete room walls
      </button>
    </div>
  </section>`;
}

function annotationPanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const a = s.level.annotations[id];
  if (!a) return projectPanel(ctx);
  if (a.kind === 'text') {
    return html`<section class="panel">
      ${header('Text label')}
      ${textField('Text', a.text, (v) => v.trim() && upd(ctx, 'annotations', id, { text: v.trim() }))}
      ${lengthField('Text height (on plan)', a.size, ctx.prefs, (v) => upd(ctx, 'annotations', id, { size: v }), { min: 20 })}
      ${dangerRow(ctx)}
    </section>`;
  }
  return html`<section class="panel">
    ${header('Dimension', formatLength(dist(a.a, a.b), ctx.prefs))}
    ${lengthField('Offset', a.offset, ctx.prefs, (v) => upd(ctx, 'annotations', id, { offset: v }))}
    ${dangerRow(ctx)}
  </section>`;
}

function refImagePanel(ctx: AppCtx, id: string): TemplateResult {
  const s = ctx.store;
  const im = s.level.refImages[id];
  if (!im) return projectPanel(ctx);
  return html`<section class="panel">
    ${header('Reference image', im.name)}
    <button class="btn primary" @click=${() => ctx.startCalibrate(id)}>Calibrate scale (2 points)</button>
    <p class="muted small">Width on plan: ${formatLength(im.widthPx * im.mmPerPx, ctx.prefs)}</p>
    ${numberField('Opacity', Math.round(im.opacity * 100), (v) => upd(ctx, 'refImages', id, { opacity: Math.min(1, Math.max(0.05, v / 100)) }), { min: 5, max: 100, step: 5, suffix: '%' })}
    ${numberField('Rotation', im.rotation, (v) => upd(ctx, 'refImages', id, { rotation: v }), { step: 1, suffix: '°' })}
    ${toggle('Visible', im.visible, (v) => upd(ctx, 'refImages', id, { visible: v }))}
    ${toggle('Locked (click-through)', im.locked, (v) => upd(ctx, 'refImages', id, { locked: v }))}
    ${dangerRow(ctx, 'Remove image')}
  </section>`;
}
