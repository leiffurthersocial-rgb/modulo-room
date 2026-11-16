# RESEARCH.md — STEP 1

How I sourced this: every source in **[S#]** was opened on 2026‑11‑16 (rendered with Chromium or downloaded raw) and read for the claims attributed to it. Claims marked **(judgement)** are my engineering opinion, not facts from a source. **Not opened:** the RoomSketcher help center, which blocks automated browsers with a Cloudflare check. I only saw search-result snippets, so nothing below relies on RoomSketcher.

---

## 1. What existing planners do (and what we take from them)

### Sweet Home 3D [S1][S2]

- **Workflow** [S1]: import a scanned plan as a background image, then draw walls over it, add doors/windows, furniture and rooms, add levels, then dimensions and text, then print.
- **Background image calibration** [S1]: "Define the scale of the image by moving the end points of the colored line … so that this line matches a known length. Then type the real length." The scale and position stay editable later. → **Adopted** as our two-point reference calibration.
- **Wall drawing** [S1]: click-click chains, with double-click or Esc to finish. Precision aids are a "walls tooltip, alignment lines" and zoom, and "you may also enter the length and the angle of the wall … after pressing the enter key". → **Adopted**: live length/angle tooltip, alignment guides, and Enter (or simply typing digits) for exact length/angle.
- **Angle magnetism** [S1]: "the angle of the walls … is a multiple of 15° by default". A modifier key temporarily disables it (Alt on Windows, Cmd on macOS). → **Adopted** with selectable 15/45/90° steps. We bind "hold Alt/Option to disable snapping" and add an on-screen toggle for touch.
- **Openings** [S1]: "Don't take doors and windows into account while drawing walls … Sweet Home 3D will automatically compute the holes." → **Adopted**: openings are parameters on a wall, and holes are generated.
- **Rooms** [S1]: either click corners, or "double-click anywhere inside an existing closed surface (i.e. surrounded by walls)". A room created this way "will include the half doorstep of each door". → **Adopted, extended**: rooms are _derived automatically_ from the wall graph (as Floorplanner does), and the user can name and override them. Door thresholds are split at the wall centreline.
- **Furniture magnetism** [S1]: with magnetism on, a piece "is automatically rotated so its back face lies along the wall", and "a piece dropped on a larger one will be elevated to appear on the top". Corner indicators handle rotate/elevate/resize, and Alt toggles 15° rotation snapping. → **Adopted**: wall-magnet and surface stacking are catalog snapping rules (`wall-aligned`, `surface-mounted`).
- **Levels** [S1]: tabs per level; lower levels are drawn faded; each level has elevation, height and floor thickness, and negative elevation means a basement. → **Adopted** for Phase 3 (the data model has these fields from day one).
- **3D cameras** [S1]: "Aerial view" (orbit) and "Virtual visit". In virtual visit, a visitor marker is drawn in the plan and updates in both views at once. → **Adopted**: the first-person camera shows a draggable avatar in 2D.
- **Dimensions** [S1]: either a three-click line (start, end, then extension-line offset), or hover over a wall/room/furniture side and double-click to take its measurement. → **Adopted** (measure tool and auto-dimension on hover).
- **License** [S2]: Sweet Home 3D and Sweet Home 3D JS are **GPL v2 or later**. → **Ideas only, no code reuse** (our project is not GPL).

### Floorplanner editor manual [S3]

- You can draw "wall by wall, or room by room. A space enclosed by walls becomes a room, and is given a room surface automatically." → **Adopted**: automatic room detection.
- While drawing: "type in your desired length and press Enter". The manual warns that "wall thickness affects the wall length when going around a corner". → This is a real UX trap; see the open question about the dimension reference line in PLAN.md.
- Room tool: drag a rectangle, then "automatic dimensions showing the interior room dimensions and exterior dimensions". "You can click the inner dimensions to set the exact room size. Click the arrows to indicate which wall should move." → **Adopted**: click a dimension to edit it, with an anchor chooser for which side moves.
- Snapping: "When drawing or dragging items you will often snap to other items … Hold S to temporarily disable snap." → Confirms a hold-to-disable modifier is standard.
- Wall editing: split a wall, drag corners or segments, "the blue arrow indicates the distance to the opposite wall. While you are dragging, you can type in the size this distance should have." → **Adopted**: distance-to-opposite-wall readout while dragging, with typed entry.
- Floors: each floor has a default wall height; a floor can hold multiple "designs" (variants). → Variants are a good later idea (noted as a stretch, not in scope).

### Planner 5D [S4] and IKEA planners [S5]

- Planner 5D markets "Draw a floor plan and create a 3D home design in 10 minutes", plus AI tools and "realistic 4K renders" [S4]. → Out of scope for us (no AI features unless you ask). Confirms that photo-style export is an expected feature.
- IKEA: room planners "create a detailed technical plan of your space, including windows, outlets and pipes", and the page notes "the IKEA kitchen planner is not compatible with mobile devices" [S5]. → Our touch-first editing is a differentiator. Outlets/pipes would be a good "fixtures" catalog category later.

### blueprint3d (open source) [S6][S7][S8][S9]

- MIT licensed ("Copyright (c) 2015 FurnishUp Inc.") [S7]. Layered as `model` / `floorplanner` (2D) / `three` (3D) / `items` [S6]. The README admits it "was rushed through various prototype stages, and never refactored", with open TODOs to remove jQuery and update three.js [S6].
- Room detection in `floorplan.ts` [S8] runs a DFS "tightest cycle" search from each corner pair, rotates every cycle to de-duplicate it, and **destroys and recreates Room objects on every change** (textures are kept in a side map keyed by room corner IDs). → **Lesson**: we use proper half-edge face traversal (§2.2), and we keep stable room IDs by matching new faces to old ones, so names and materials survive edits.
- A 2026 community rewrite (blueprint3d-modern) moved to BufferGeometry and three r181, uses raycasting filtered per item placement type (FloorItem / WallItem / InWallItem / CeilingItem), and has IndexedDB storage [S9]. One reply notes that wall/floor **UVs "around corners and different room shapes … usually gets tricky fast"** [S9]. → **Adopted**: placement types map to our snapping rules; UVs will use world-space metric mapping (§3.4).

---

## 2. Geometry

### 2.1 Walls as a graph

- **Model**: `nodes {id, x, y}` and `walls {id, a, b, thickness, height(Start/End), justification, materials{left,right}}`. A wall is an undirected edge (judgement; this matches blueprint3d's Corner/Wall [S6][S8] and Sweet Home 3D's wall chains [S1]).
- **Derived half-edges (DCEL)**: "Each half-edge has exactly one previous half-edge, next half-edge and twin", and faces can carry data such as "the name of the area" [S10]. We build a DCEL from the wall graph on every change. It is cheap for hundreds of walls (judgement).
- **Invariants enforced by commands**: no zero-length walls; endpoints within ε (0.5 mm) merge; a wall crossing another wall splits both at the intersection (planarisation, which a DCEL needs [S10]); T-junctions are a node on the split wall.

### 2.2 Room polygons from the graph

Algorithm (standard planar face traversal, judgement): for every half-edge, the next half-edge is the outgoing edge at the destination node that makes the **smallest clockwise turn** (sort outgoing edges by angle). Walk until you return to the start. Faces with positive signed area are rooms. The single negative face per connected component is the outside. Dangling walls (degree‑1 nodes) are walked on both sides and drop out naturally.

- **Room polygon** = the face cycle offset inward by each wall's half-thickness, i.e. the interior faces of the walls, computed with the same miter logic as §2.3.
- **Stable IDs**: match new faces to previous rooms by (a) identical set of bounding wall IDs, else (b) maximum area overlap. Splitting a room keeps the ID on the larger part.
- **Holes and islands**: a free-standing wall loop inside a room becomes a hole of that room (face containment test), so a column, chimney or kitchen island is handled.
- **Triangulation** for the floor/ceiling mesh: ear clipping handles polygons with holes [S11]. earcut (ISC) is the reference implementation [S12].

### 2.3 Mitered wall joins

Judgement (standard technique): at each node, sort incident walls by angle. For each adjacent pair, intersect the left offset line of one wall with the right offset line of the next. That point is the shared corner of both wall outlines. Special cases:

- degree 1: square end cap;
- near-parallel neighbours (angle ≈ 180°): skip the intersection and use the perpendicular point (no spike);
- very sharp angles: apply a **miter limit** (e.g. 3× thickness), then bevel;
- walls of different thicknesses: the same intersection still works because each wall uses its own offsets.

The wall footprint polygon (up to 6 vertices) is used for 2D fill, hit-testing and 3D extrusion. Straight skeletons solve the _roof/attic_ problem (the "shrinking process … and the roof model" [S13]); they are noted for sloped roofs later and are not needed for walls.

### 2.4 Door and window openings

- **Representation**: an opening belongs to one wall and stores `offset` (mm from node A along the axis, to the opening centre), `width`, `height`, `sill`, `type`, `hinge` (start/end), `swing` (left/right side), `opensInward`. It moves with its wall and is clamped to the wall's length, which fixes the "doors don't stay attached when a wall moves" complaint in Sweet Home 3D's forum (search snippet only, so not relied on).
- **3D cut-outs**: rectangular openings are generated directly, without CSG (judgement). Each wall side face is a 2D polygon (in wall-local u = along, v = up) with rectangular holes, triangulated with earcut [S12]. Jamb, head and sill faces are then added as quads. This is fast and exact, and gives clean UVs.
- **CSG fallback**: three-bvh-csg (MIT) says it is "More than 100 times faster than other BSP-based three.js CSG libraries" but describes itself as "experimental, in progress" [S14]. → **Not used** for walls. It stays an option for odd shapes (arched or round windows) in Phase 4+.

### 2.5 Snapping

Priority order, each snap only within a screen-space radius (larger for touch), and the winner is shown as a visual guide (judgement, consistent with [S1][S3]):

1. existing endpoint / node
2. wall midpoint, wall face/axis projection (point on wall)
3. alignment guides: horizontal/vertical extension through other nodes (Sweet Home 3D's "alignment lines" [S1])
4. angle snapping relative to world and to the previous segment (15/45/90° steps [S1]); parallel/perpendicular to nearby walls
5. length rounding (grid step / 10 mm)
6. grid

A held modifier (Alt/Option, like [S1]; Floorplanner uses S [S3]) or the toolbar magnet toggle disables snapping. The snapping engine is a pure function `snap(point, context) → {point, guides[]}`, which makes it unit-testable.

### 2.6 Non-rectangular and sloped/attic rooms

- Arbitrary polygons come for free from the graph. Curved walls are out of scope for Phase 1 (judgement: they could later be modelled as an arc parameter on an edge, tessellated).
- Sloped ceilings: walls carry `heightStart/heightEnd` (a knee wall to a gable), and levels can define **ceiling planes** (a plane equation clipped to the room polygon) in Phase 3. The ceiling mesh is the room polygon lifted onto the min(height, plane) surface. Straight-skeleton roofs [S13] are a stretch.

---

## 3. Editor UX

### 3.1 Undo/redo — command pattern

"If all user actions in a program are implemented as command objects, the program can keep a stack of the most recently executed commands" [S15]. Our design (judgement):

- Each command is `{type, payload}` (serializable JSON). `apply(doc) → {doc', inverse}` is a pure function.
- **Coalescing**: a drag emits many `move` updates but commits one history entry (preview with a transient state, commit on pointerup).
- **Transactions**: compound edits (split wall + insert node + move opening) go into one `batch` command.
- The history log is serializable, which enables the "commands as a log" requirement and later replay/collaboration hooks.

### 3.2 Selection and transforms

Click to select, Shift-click to add, rubber-band select (as in Sweet Home 3D [S1]); long-press on touch opens the context menu. Copy/paste uses the clipboard as JSON with fresh IDs. Rotation snaps to 15° with the modifier toggle [S1]. Mirror flips about the item's axis (doors flip hinge/swing).

### 3.3 Numeric entry and dimension lines

- Typing digits while drawing opens an inline length field; Tab switches to angle; Enter commits [S1][S3]. Units are parsed from text (`3.2m`, `320cm`, `10' 6"`, `10'6 1/2"`).
- Click any dimension label to edit; for room/inner dimensions an anchor arrow chooses which side moves [S3].
- Lock length: a wall flag that makes drags preserve the length (rotate about the other end).

### 3.4 Touch, Pencil and hit targets

- **Pointer Events** give one model for "a mouse, pen/stylus or touch (such as one or more fingers)" and expose `pressure` and contact geometry [S16]. `pointerType` distinguishes `mouse`/`pen`/`touch` [S17]. Verified in our headless tests (ENVIRONMENT.md).
- `touch-action: none` on the canvas stops the browser from pan/zooming so we can handle pinch and two-finger pan ourselves [S18].
- **Apple Pencil precision / palm rejection** (judgement): when a `pen` pointer is active, ignore `touch` pointers for tool actions (palm), but still allow a two-finger touch gesture for pan/zoom. Pen uses a small snap radius; touch uses a large one.
- **Hit-target sizes**: Apple HIG minimum control size **44×44 pt** on iOS/iPadOS [S19]. WCAG 2.2 SC 2.5.8 requires at least **24×24 CSS px** (AA), and 2.5.5 uses **44×44** for AAA [S20]. → Toolbar buttons 44 px. Plan handles are drawn at 12–16 px but have **44 px touch hit areas** (24 px for mouse).
- Keyboard: shortcut map plus a `?` cheat-sheet overlay. Every tool is reachable without a pointer (Phase 3 accessibility pass).

### 3.5 2D renderer: SVG vs Canvas2D → **Canvas2D on screen, with an SVG/PDF export backend**

| Factor                      | SVG                                                                                       | Canvas2D                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Pan/pinch at 60 fps on iPad | transforms are cheap, but text/stroke re-layout at every zoom level costs; many DOM nodes | single redraw; MDN recommends layering static vs dynamic content [S21]                                        |
| Hit-testing                 | native, but tied to _visual_ size                                                         | we do geometric hit-testing in model space anyway (needed for 44 px touch targets independent of the drawing) |
| Line weights under zoom     | `vector-effect: non-scaling-stroke` [S22]                                                 | trivial (set lineWidth / scale)                                                                               |
| Export quality              | free                                                                                      | need a vector backend                                                                                         |
| Accessibility               | DOM nodes can carry ARIA                                                                  | needs a parallel ARIA list                                                                                    |

**Decision (judgement)**: the plan renderer produces a **display list** (lines, polygons, arcs, text, hatches) in model space. A Canvas2D backend draws it on screen with layered canvases (static grid/reference image vs dynamic plan vs interaction overlay [S21]). An SVG-string backend writes it for SVG export, and PDF later reuses it. Inline numeric editors and the context menu are DOM overlays. Accessibility: a visually hidden list of selectable objects mirrors the selection for screen readers (Phase 3).

### 3.6 UI layer

lit-html can be used standalone (`render(template, container)`) without the Lit component model [S23]. → **Adopted** for panels, toolbars and dialogs: small, declarative, no framework runtime. No heavy framework is justified, because the hot paths (canvas, WebGL) bypass the DOM anyway (judgement).

---

## 4. 3D

### 4.1 Sync strategy

The pure model emits **change sets** (`{added, updated, removed}` IDs per entity type) after each command. The 3D view keeps a `Map<entityId, Object3D>` and rebuilds only dirty entities. A wall change also dirties its neighbours (miters) and rooms (polygons). The 3D view never mutates the model; 3D drags issue the same commands as 2D (judgement).

### 4.2 Cameras

Orbit (default), top-down orthographic, isometric (orthographic at 35.264°/45°), and first-person. Sweet Home 3D's virtual visitor is mirrored in the plan [S1]. First-person on desktop uses the **Pointer Lock API** ("input methods based on the movement of the mouse over time (i.e., deltas)") [S24]; on touch, a virtual joystick plus drag-to-look. **Collision** is done in 2D: a capsule (radius ≈ 200 mm) vs wall footprint segments and furniture OBBs, with sliding response. No physics engine (judgement).

### 4.3 Cutaway

Per wall, compute the outward normal of the room side facing the camera. If the camera is outside the room the wall bounds and the wall faces the camera, fade it (opacity→0.15) or drop it to a low "dollhouse" height. Modes: auto, show all, dollhouse (all walls cut at ~1 m), ceiling on/off. Floorplanner offers a similar "show ceilings" toggle in its 3D view settings [S3]. The fade test runs only on camera change (judgement).

### 4.4 Realistic interior rendering (Phase 4, greybox now)

- Tone mapping: three.js supports `AgXToneMapping`, `NeutralToneMapping`, `ACESFilmicToneMapping` and others via `renderer.toneMapping` [S25].
- Ambient occlusion: three.js `GTAOPass` "provides better quality than SSAOPass but is also more expensive" and offers a denoised output [S26]. N8AO (CC0) [S27] and pmndrs/postprocessing (zlib) [S28] are alternatives with merged effect passes. → Pick by measurement on iPad in Phase 4.
- Baked AO: Blender Cycles can bake AO "as a base for texture painting", which avoids "intensive light/shadow solutions" at runtime; it needs UV maps [S29]. → For _static_ imported furniture models, bake AO into the asset at processing time. Room AO stays dynamic, since rooms are user geometry.
- **Render on demand**: rendering continuously "is a waste of the devices power and … wastes the user's battery". Render once, then "only when something changes", using OrbitControls' `change` event [S30]. → **Adopted from Phase 2**, not only in Battery Saver (editing mode always renders on demand).
- Dispose geometries/materials/textures explicitly when rebuilding meshes [S31], which is essential for incremental rebuilds on iPad.

---

## 5. Data

- **Versioned JSON**: `{format:"modulo-room", schemaVersion:N, units:"mm", project:{…}}`. Migrations are an ordered list of pure functions `vN → vN+1`. Unit tests load fixtures from each older version (judgement).
- **Units**: integers aren't required. Store mm as JS numbers (float64), round displays, and parse units on input (§3.3).
- **Persistence**: IndexedDB through `idb` (ISC) [S32]. Browser storage is "best-effort" by default, and `navigator.storage.persist()` opts into persistent storage [S33][S34]. WebKit since Safari 17 gives a browser origin up to **60% of disk**, and evicts least-recently-used origins under pressure or "when the site has not been interacted with by the user for some time" (ITP) [S35]. → Call `persist()`, show a "last exported" reminder, and make `.json` export one tap.
- **Export**: PNG (canvas), SVG (display list backend), PDF (Phase 3; library TBD, not researched yet), glTF (three's GLTFExporter, Phase 3), OBJ (optional), DXF (Phase 3 stretch; a minimal LINE/LWPOLYLINE writer is enough for a plan).
- **Asset formats (Phase 4)**: KTX 2.0 with Basis Universal; ETC1S gives "significantly smaller transmission and GPU memory sizes than JPEG and PNG", and UASTC gives higher quality [S36]. The registered media type is **`image/ktx2`** [S37] (used in vercel.json). gltf-transform's CLI supports Draco and Meshopt compression and `simplify` [S38].

---

## 6. iPad Safari memory and performance

- There is **no official published per-tab memory figure**. An Apple Developer Forums thread asking exactly this ("Browser memory limit on IOS") has 0 replies [S39].
- WebKit bug 300782 (Oct 2025, status NEW): texture-heavy WebGL pages "get terminated by iOS memory pressure and immediately reloaded by Safari, causing an endless reload loop". "No explicit OOM error is surfaced to JS, nor 'webglcontextlost' is observed" [S40].
- **Consequences for us** (judgement): (1) the GPU memory is our budget to manage, so use KTX2 (GPU-compressed), texture tiers 512/1k/2k and dispose aggressively [S31]; (2) **crash-loop guard**: write a `booting` flag to sessionStorage at startup and clear it after the first stable frames. If the flag is present at the next load, start in Battery Saver with low textures and show a notice; (3) handle `webglcontextlost`/`restored` anyway; (4) keep a JS-side texture/geometry byte counter and display it in a dev HUD, so the "under ~1 GB" target is measurable rather than guessed; (5) cap the pixel ratio (≤ 2, and lower in Battery Saver).

---

## 7. Recommended architecture (one page)

```
src/
  model/        PURE TS. Types, schema, ids, units, migrations. No DOM, no three (lint-enforced)
  geometry/     PURE TS. vec2, DCEL/rooms, miters, wall footprints, openings, snapping, OBB/SAT, earcut wrapper
  commands/     PURE TS. Command registry, apply/inverse, history (undo/redo, coalescing, batch), change sets
  catalog/      catalog.json + schema validation; procedural primitive builders (pure param → box list)
  persistence/  IndexedDB autosave (debounced), project gallery, import/export, storage.persist()
  editor2d/     Display-list builder (pure) → Canvas2D backend + SVG backend; tools (state machines); input pipeline
  view3d/       three.js: scene sync from change sets, mesh builders, cameras, cutaway, first-person, picking
  ui/           lit-html panels, toolbars, dialogs, shortcuts overlay, layout modes (2D / 3D / split / PiP)
  app/          Store (doc + history + selection + view state), wiring, quality presets, screenshot mode
```

- **One store, one direction**: tools and UI dispatch commands → the store applies them → change set → 2D redraw and incremental 3D sync. Selection and view state are separate from the document (not undoable, except selection restore on undo).
- **2D** = Canvas2D display list (layered), geometric hit-testing with per-pointer-type tolerances, DOM overlays for numeric fields.
- **3D** = three.js WebGLRenderer (WebGL2), render on demand, per-entity incremental rebuilds, generated wall geometry with openings (no CSG), 2D collision for walkthrough.
- **Persistence** = IndexedDB autosave plus explicit `.json` export; the schema is versioned with migrations from v1.
- **Tests** = Vitest for model/geometry/commands/snapping/units/serialization; Playwright desktop + iPad profiles with screenshot mode.
- **Deploy** = Vite static build + vite-plugin-pwa (precache app shell; runtime cache for assets) → Vercel (headers in `vercel.json`).

## 8. Risks

| #   | Risk                                                                                              | Impact                         | Mitigation                                                                                         |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| R1  | iOS kills the tab without warning under GPU memory pressure, with a reload loop [S40]             | data loss / unusable           | autosave on every commit; crash-loop guard → safe mode; texture budget + byte counter; KTX2 [S36]  |
| R2  | Room detection on messy graphs (overlaps, near-collinear, tiny gaps)                              | wrong rooms, broken floors     | planarisation + ε-merge in commands; property tests with random and tricky graphs; stable room IDs |
| R3  | Wall-length semantics (centreline vs inside face vs outside) confuse users [S3]                   | "my room is 15 cm too small"   | explicit reference-line setting and labelled dimensions (Q1 in PLAN.md)                            |
| R4  | Real Safari behaviour differs from our Chromium "iPad" profile (pointer lock, pinch, PWA, memory) | late surprises                 | optional Playwright WebKit (Q4); manual iPad checks at each phase stop                             |
| R5  | Storage eviction on Safari (ITP / LRU) [S35]                                                      | lost projects                  | `storage.persist()` [S33], export reminders, gallery shows "last exported"                         |
| R6  | Canvas2D accessibility                                                                            | screen-reader users locked out | parallel ARIA object list, keyboard-only tools (Phase 3)                                           |
| R7  | Mitered geometry edge cases (very acute angles, thickness changes at T-junctions)                 | spikes / gaps in 3D            | miter limit + bevel; screenshot tests of a "torture" plan                                          |
| R8  | Asset sources blocking automation (Kenney 403, RoomSketcher Cloudflare)                           | Phase 4 gaps                   | download on your machine with documented commands; never work around bot checks                    |
| R9  | Headless SwiftShader is slow for realism tests                                                    | flaky perf numbers             | perf numbers only from real devices / a local GPU; CI checks correctness only                      |
| R10 | Toolchain churn (TS 7 vs typescript-eslint, Vite 8/rolldown)                                      | upgrade friction               | exact pins + lockfile; DECISIONS.md log                                                            |

---

## Sources (opened)

- [S1] Sweet Home 3D User's Guide — https://www.sweethome3d.com/userGuide.jsp
- [S2] Sweet Home 3D License — https://www.sweethome3d.com/license.jsp
- [S3] Floorplanner Editor Manual (PDF, v05-07-18) — https://cdn.floorplanner.com/static/brochures/Floorplanner+editor+manual+version+050718.pdf
- [S4] Planner 5D home page — https://planner5d.com/
- [S5] IKEA US Design & planning — https://www.ikea.com/us/en/planners/
- [S6] furnishup/blueprint3d README — https://github.com/furnishup/blueprint3d
- [S7] blueprint3d LICENSE.txt — https://raw.githubusercontent.com/furnishup/blueprint3d/master/LICENSE.txt
- [S8] blueprint3d `src/model/floorplan.ts` — https://raw.githubusercontent.com/furnishup/blueprint3d/master/src/model/floorplan.ts
- [S9] "Blueprint3D Modern" thread, three.js forum — https://discourse.threejs.org/t/blueprint3d-modern-a-full-typescript-three-js-r181-rewrite-of-the-abandoned-blueprint3d-floor-planner/90610 (read via `/raw/90610`)
- [S10] Doubly connected edge list — https://en.wikipedia.org/wiki/Doubly_connected_edge_list
- [S11] Polygon triangulation — https://en.wikipedia.org/wiki/Polygon_triangulation
- [S12] mapbox/earcut — https://github.com/mapbox/earcut
- [S13] Straight skeleton — https://en.wikipedia.org/wiki/Straight_skeleton
- [S14] gkjohnson/three-bvh-csg — https://github.com/gkjohnson/three-bvh-csg
- [S15] Command pattern — https://en.wikipedia.org/wiki/Command_pattern
- [S16] MDN Pointer events — https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- [S17] MDN PointerEvent.pointerType — https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType
- [S18] MDN touch-action — https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- [S19] Apple HIG, Accessibility — https://developer.apple.com/design/human-interface-guidelines/accessibility
- [S20] W3C, Understanding SC 2.5.8 Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [S21] MDN Optimizing canvas — https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- [S22] MDN SVG `vector-effect` — https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect
- [S23] Lit, Using lit-html standalone — https://lit.dev/docs/libraries/standalone-templates/
- [S24] MDN Pointer Lock API — https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
- [S25] three.js docs, WebGLRenderer.toneMapping — https://threejs.org/docs/#WebGLRenderer.toneMapping
- [S26] three.js r187 `GTAOPass.js` doc comment — https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/jsm/postprocessing/GTAOPass.js (docs page https://threejs.org/docs/pages/GTAOPass.html renders the same text in an iframe)
- [S27] N8python/n8ao — https://github.com/N8python/n8ao
- [S28] pmndrs/postprocessing — https://github.com/pmndrs/postprocessing
- [S29] Blender Manual, Cycles Render Baking — https://docs.blender.org/manual/en/latest/render/cycles/baking.html
- [S30] three.js manual, Rendering on Demand — https://threejs.org/manual/#en/rendering-on-demand
- [S31] three.js manual, How to dispose of Objects — https://threejs.org/manual/#en/cleanup
- [S32] jakearchibald/idb — https://github.com/jakearchibald/idb
- [S33] MDN StorageManager.persist() — https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- [S34] MDN Storage quotas and eviction criteria — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- [S35] WebKit blog, Updates to Storage Policy — https://webkit.org/blog/14403/updates-to-storage-policy/
- [S36] Khronos, KTX overview — https://www.khronos.org/ktx/
- [S37] KTX spec, media-type registration — https://raw.githubusercontent.com/KhronosGroup/KTX-Specification/main/ktx-media-registration.adoc
- [S38] glTF Transform CLI — https://gltf-transform.dev/cli
- [S39] Apple Developer Forums, "Browser memory limit on IOS" — https://developer.apple.com/forums/thread/741624
- [S40] WebKit Bugzilla 300782 — https://bugs.webkit.org/show_bug.cgi?id=300782
- Also opened for licenses only: polygon-clipping (MIT) https://github.com/mfogel/polygon-clipping, Clipper2 (BSL-1.0; C++/C#/Delphi only) https://github.com/AngusJohnson/Clipper2, three-mesh-bvh (MIT) https://github.com/gkjohnson/three-mesh-bvh, Vercel project configuration https://vercel.com/docs/project-configuration, vite-plugin-pwa guide https://vite-pwa-org.netlify.app/guide/.
