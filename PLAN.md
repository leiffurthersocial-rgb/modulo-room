# PLAN.md — Modulo: Room

Status: **Phase 1 done — awaiting your review** (see docs/phase-1-review.md). Plan approved 2026-11-16 ("make it usable, greybox"); open questions answered with the proposed defaults (Q1 inside faces, Q2 no PRs, Q4 no WebKit yet, Q5 metric, Q6 keep hosts). Scope for now: **greybox only** (Phases 1–3). Phases 4–5 are listed for orientation and will be re-planned when you unlock them.
Architecture and reasoning: RESEARCH.md §7. Decision log: DECISIONS.md.

## Ground rules I'll follow

- Commit after each milestone (M-numbers below) on `claude/modulo-room-setup-6dw6kc`. Each push gets a Vercel preview once you've imported the repo.
- After any visual change: Playwright screenshots on desktop + iPad profiles, critiqued before I claim success.
- **Stop at the end of each phase** with a summary, screenshots, performance numbers, open questions and a next-milestone proposal.
- Tests first for pure code (geometry, commands, units, serialization).

---

## Phase 1 — Core model and 2D editor (greybox)

### M1.1 Model, units, schema, commands

- `model/`: types for Project → Levels → {nodes, walls, openings, rooms (derived + user overrides), items, lights, annotations, referenceImages}. IDs are short random strings.
- `units`: mm internally; format/parse metric (m/cm/mm) and imperial (ft-in with fractions, e.g. `10' 6 1/2"`).
- `schema`: `schemaVersion: 1`, validator, migration runner (with a v0 → v1 test fixture to prove the mechanism).
- `commands/`: registry, `apply → inverse`, history (undo/redo, coalescing, batch), change sets.
- Tests: units round-trip and parsing; undo/redo invariants (apply ∘ inverse = identity, as a property test over random command sequences); serialization round trip.

### M1.2 Geometry kernel

- Planarisation (ε-merge, split on crossing), DCEL build, face traversal → rooms with holes, stable room IDs.
- Mitered wall footprints (miter limit, bevel, mixed thickness, T and X junctions).
- Openings: placement and clamping along a wall, overlap rejection, follow wall on move.
- Snapping engine: endpoint, midpoint, on-wall, alignment guides, angle (15/45/90), parallel/perpendicular, grid. Returns the snapped point plus guides.
- Tests: tricky graphs (L, U, T, nested room/island, dangling walls, collinear chains, near-coincident nodes, crossing walls), miter outputs, snapping priority cases.

### M1.3 2D editor shell

- App layout (toolbar, inspector panel, status bar), lit-html UI, light/dark aware.
- Canvas2D display-list renderer with layers (grid/reference, plan, overlay). Pan/zoom (wheel, trackpad pinch, two-finger touch, keyboard), scale bar, north arrow.
- Input pipeline: pointer normalisation, per-type hit tolerance (mouse 6 px, pen 6 px, touch 22 px radius ≈ 44 px target), palm rejection while pen is active, long-press → context menu.
- Select/move tool: click, shift-click, rubber band, drag with snapping, delete, undo/redo buttons and shortcuts.

### M1.4 Walls, rooms, dimensions

- Wall tool: click-click chains, live length/angle tooltip, type-to-enter length (Tab → angle), Esc/double-click to finish, close on start node.
- Rectangle-room tool (4 walls in one batch).
- Thickness presets 100/150/200/300 mm + custom; wall height default per level.
- Dimension lines: automatic wall dimensions (configurable reference line, see Q1), room inner dimensions; click a dimension to edit, with an anchor chooser for which side moves; lock-length flag.
- Room labels: name + area (m² / ft²), editable name.
- Units toggle (metric / imperial) everywhere.

### M1.5 Openings and furniture

- Door/window tool: snaps onto walls, live offset dimensions to the nearest corners, flip hinge/swing, plan symbols (door leaf + swing arc, window triple line, sliding door, double door, opening without leaf).
- Catalog `catalog.json` (validated): beds, sofas, tables, chairs, wardrobes, shelves, desks, kitchen units, bathroom fixtures, plants, lamps, rugs, plus a **custom box**. Every entry has real dimensions, a snapping rule, tags and a primitive recipe (a list of boxes/cylinders in normalised space, scaled to the dimensions).
- Place, move, rotate (15° snap), resize (numeric in the inspector), mirror, lock, duplicate, copy/paste.
- Wall magnet (back to wall, as in [S1]) and surface stacking.
- Warnings: furniture overlap (OBB/SAT), door-swing blocked, walkway < 800 mm (configurable), shown as overlays plus an issues list. Clearance-zone toggle.
- Measure tool, text label tool, erase tool.

### M1.6 Persistence, reference image, polish

- Autosave to IndexedDB (debounced after each commit), `storage.persist()`, crash-loop guard flag (used fully in Phase 2).
- Import/export `.json` (download + file picker + drag-and-drop).
- Reference image: import (stays local), two-point calibration with a real-distance entry, opacity, rotation, move, lock.
- Keyboard shortcuts plus a `?` cheat-sheet overlay.
- Playwright e2e: draw a 4.00 × 3.00 m room with exact typed lengths, add a door and a window, place a bed and a desk, undo/redo, export/import round trip; desktop + iPad (touch-only flow on iPad).
- **STOP: Phase 1 review** (screenshots, test report, deployed preview).

## Phase 2 — 3D view synced to the model (greybox)

- **M2.1** Scene sync from change sets; mesh builders: walls with generated openings (earcut), floors and ceilings with holes, door/window greybox frames and leaves, furniture primitives, flat materials. World-space UVs in metres (ready for Phase 4).
- **M2.2** Layout modes (2D / 3D / split / picture-in-picture); cameras: orbit, top orthographic, isometric; render on demand; resize/dispose hygiene; `webglcontextlost` handling; crash-loop safe mode.
- **M2.3** Cutaway (auto / show all / dollhouse / ceiling on-off), hover tooltips (name + size), dimension overlay toggle.
- **M2.4** First-person: pointer lock + WASD on desktop, joystick + drag-look on touch, eye height setting, 2D capsule collision vs walls and furniture, "walk to this spot", avatar mirrored in 2D, camera bookmarks.
- **M2.5** 3D editing: pick, drag on the floor with the same snapping engine, rotate gizmo, inspector edits, all through commands (mirrored in 2D).
- **M2.6** Basic lighting (hemisphere + one directional, simple shadows toggle). Benchmark route `/bench` with a 100-item, 10-room project and a scripted camera path logging avg/p95 frame time.
- **STOP: Phase 2 review.** Targets: 60 FPS desktop, 30+ FPS iPad (measured on your iPad via `/bench`, since headless SwiftShader numbers aren't representative).

## Phase 3 — Planning tools and quality of life (greybox)

Levels + stairs, templates (bedroom, studio apartment), copy/paste across levels, clearance checks, takeoff list (floor area, wall area, paint estimate, items list), 3D measure tool, named bookmarks, project gallery, exports (PNG 2D/3D, SVG, PDF with scale and title block, glTF), shareable file import, accessibility pass (keyboard-only editing, contrast, UI scale, ARIA object list). Sloped ceilings (ceiling planes) here.

## Phase 4 — Real assets and realism (later, on your go)

Asset fetch/process scripts, LICENSES.json + credits, KTX2 tiers, model mapping by catalog id (dimensions win), material library + `/lab`, Render mode (AgX, GTAO/N8AO, soft shadows, bloom, SMAA/TAA, DOF, AO, reflections, tiled photo export).

## Phase 5 — Quality tiers, Battery Saver, polish (later)

Presets Ultra → Battery Saver + Custom, FPS cap, pause when hidden, frame-time watchdog, verified iPad memory budget, onboarding, sample projects, credits.

---

## Data model sketch (v1)

```ts
Project { format:'modulo-room', schemaVersion:1, id, name, units:{display:'metric'|'imperial', metricUnit:'m'|'cm'|'mm'},
  northAngleDeg, levels: Level[], settings:{grid, snapping, wallReferenceLine, walkwayMinMm}, createdAt, updatedAt }
Level  { id, name, elevationMm, heightMm, floorThicknessMm,
  nodes: Node[]            // {id, x, y}
  walls: Wall[]            // {id, a, b, thicknessMm, heightStartMm, heightEndMm, justification:'center'|'left'|'right', lockedLength?, material:{left?, right?}}
  openings: Opening[]      // {id, wallId, kind:'door'|'window'|'sliding'|'double'|'opening', offsetMm, widthMm, heightMm, sillMm, hinge:'start'|'end', swing:'left'|'right'}
  roomMeta: RoomMeta[]     // user data keyed by stable room id: {id, name, floorMaterial?, ceilingMaterial?, ceilingHeightMm?}
  items: Item[]            // {id, catalogId, x, y, rotationDeg, widthMm, depthMm, heightMm, elevationMm, mirrored, locked, materialOverrides}
  lights: Light[]          // {id, kind:'point'|'spot'|'panel'|'strip', x,y,z, kelvin, lumens, ...}
  annotations: Annotation[]// dimension {a,b,offset} | text {x,y,text,size}
  referenceImages: RefImage[] // {id, blobKey, x, y, rotationDeg, mmPerPx, opacity, locked}
}
// Rooms (polygons, areas) are DERIVED and never stored, except RoomMeta keyed by stable id.
```

## Open questions (please answer with your OK)

- **Q1. Which line should wall dimensions measure by default?** Proposal: draw walls on the **centreline** (simplest graph), but the **rectangle-room tool and the room dimensions use interior faces**, so "4.00 × 3.00 m room" means the usable floor. Wall labels show interior length by default, and there is a setting for centreline/exterior. OK?
- **Q2. Branching.** Should I keep everything on `claude/modulo-room-setup-6dw6kc` (Vercel previews) and open a PR to `main` at each phase stop for you to merge (= production deploy)? I won't open PRs unless you say yes.
- **Q3. Vercel previews.** Please send the preview/production URL once imported, and relax preview protection if you want me to verify deployed builds (SETUP.md §4).
- **Q4. Real Safari engine in tests.** I can add a Playwright **WebKit** project (closer to iPad Safari for pinch, pointer and PWA quirks). That needs one more allowed host for the WebKit browser download (`cdn.playwright.dev` and its mirror `playwright.download.prss.microsoft.com`, both listed in playwright-core's download registry). Want that? I'd ask through the usual environment prompt.
- **Q5. Default units / locale.** Metric (m, with cm precision) by default? North defaults to "up".
- **Q6. Research hosts.** Keep the documentation hosts on the `modulo-room` environment (handy for later research) or remove them now?

## Proposal for the next step

On your OK: M1.1 + M1.2 (model, commands, geometry kernel with tests). These are pure code with no UI, so they're fast to review via test output. Then M1.3–M1.6 with screenshots, and a Phase 1 stop.
