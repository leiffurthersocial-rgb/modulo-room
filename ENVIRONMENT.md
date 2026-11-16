# ENVIRONMENT.md — STEP 0 audit

Audit date: 2026-11-16. Machine: the Claude Code cloud container that built this repo.
Re-run the checks with `npm run env:check`.

## System

| Item       | Result                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS         | Ubuntu 24.04.5 LTS, Linux 6.18 x86_64, 4 vCPU, 15 GiB RAM                                                                                                                                            |
| Disk       | 30 GB free on `/` (fixed per-session allowance)                                                                                                                                                      |
| Node / npm | v22.23.4 / 10.9.9 (also pnpm 10.28, yarn 1.22, bun available)                                                                                                                                        |
| git        | 2.43.0. Push to `origin` works through the session's git proxy.                                                                                                                                      |
| Python     | 3.13.18                                                                                                                                                                                              |
| GitHub CLI | `gh` 2.89.0 is installed, but `gh auth status` says the injected `GH_TOKEN` is invalid. GitHub access in this session goes through the GitHub MCP tools and the git proxy instead; `gh` is not used. |
| Vercel CLI | Not installed, and no token. **Decision (yours): you will import the repo into Vercel yourself** (see SETUP.md §4). No secret is stored in this environment.                                         |

## Browser automation / WebGL2

| Item                   | Result                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright             | 1.63.0 (pinned in `package.json` to match the preinstalled browser)                                                                                                                                                                                    |
| Chromium               | 153.0.8010.12 headless                                                                                                                                                                                                                                 |
| WebGL2 headless        | **Works** with no flags and with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Renderer string: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`. MAX_TEXTURE_SIZE 8192, `EXT_color_buffer_float` available. |
| Flags used             | `playwright.config.ts` pins `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, so CI and your machine use the same software rasterizer and screenshots are comparable.                                                      |
| WebKit (Safari engine) | **Not installed.** The "iPad" profile is Chromium with an iPad viewport, touch and Safari UA. It is not real Safari. See open question Q4 in PLAN.md.                                                                                                  |

### Screenshot mode

`?screenshot=1` gives a fixed pixel ratio of 1, a single deterministic render (no animation loop) and `preserveDrawingBuffer`. When the frame is ready the page sets `window.__mrReady = true` and `<html data-ready="true">`, and tests wait for that (`tests/e2e/fixtures.ts → openScreenshotMode`). Every test fails automatically on any console error or uncaught page error.

### Profiles (`playwright.config.ts`)

- **desktop**: 1440×900, mouse + keyboard, DPR 1 (DPR 2 for screenshots meant for people).
- **ipad**: 1180×820 landscape, `hasTouch: true`, `isMobile: false` (iPadOS Safari presents a desktop UA), Safari UA string.

### Input tests (all passing, `tests/e2e/input.spec.ts`)

| Test                                                                                                                  | desktop | ipad |
| --------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| Mouse → `pointerType=mouse`                                                                                           | ✅      | ✅   |
| Touch tap → `pointerType=touch`                                                                                       | n/a     | ✅   |
| Two simultaneous touch points → 2 distinct `pointerId`s (pinch/pan groundwork, via CDP `Input.dispatchTouchEvent`)    | n/a     | ✅   |
| Pen (Apple Pencil stand-in) → `pointerType=pen` with pressure (via CDP `Input.dispatchMouseEvent{pointerType:'pen'}`) | ✅      | ✅   |
| Boot: WebGL2, non-blank canvas, screenshot                                                                            | ✅      | ✅   |
| PWA manifest served + service worker active                                                                           | ✅      | ✅   |

Result: 10 passed, 2 skipped (touch-only tests on desktop), about 9 s.

## Network (through the session's egress proxy)

The session started on your **Default** environment, which allowed only GitHub, npm and Vercel. With your OK I created a personal environment **`modulo-room`** and moved this session onto it. Its allowlist (exact hosts, no wildcards):

- Repo/deploy: github.com, api.github.com, raw.githubusercontent.com, release-assets.githubusercontent.com, objects.githubusercontent.com, vercel.com, api.vercel.com
- Assets (Phase 4): api.polyhaven.com, dl.polyhaven.org, ambientcg.com, quaternius.com, kenney.nl, sketchfab.com, api.sketchfab.com, download.blender.org
- Fonts: fonts.googleapis.com, fonts.gstatic.com
- Research (STEP 1): www.sweethome3d.com, help.roomsketcher.com, cdn.floorplanner.com, help.floorplanner.com, planner5d.com, www.ikea.com, threejs.org, discourse.threejs.org, developer.mozilla.org, developer.apple.com, webkit.org, bugs.webkit.org, www.w3.org, vite-pwa-org.netlify.app, lit.dev, gltf-transform.dev, www.khronos.org, en.wikipedia.org, docs.blender.org, www.npmjs.com
- Package registries (npm, PyPI, …) are allowed by default.

| Host                              | Before (Default env)   | After (`modulo-room` env)                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| github.com (git push)             | ✅                     | ✅                                                                                                                                                                                                                                                                                   |
| registry.npmjs.org                | ✅ 200                 | ✅ 200                                                                                                                                                                                                                                                                               |
| api.polyhaven.com                 | ❌ proxy 403           | ✅ 200 (`/types`, `/files/<id>` return JSON)                                                                                                                                                                                                                                         |
| dl.polyhaven.org                  | ❌ proxy 403           | ⚠️ reachable. The bare `/` gives 521 (origin), which is expected; a real file download is not tested yet (Phase 4).                                                                                                                                                                  |
| ambientcg.com                     | ❌ proxy 403           | ✅ 200 (`/api/v2/full_json`)                                                                                                                                                                                                                                                         |
| quaternius.com                    | ❌ proxy 403           | ✅ 200                                                                                                                                                                                                                                                                               |
| kenney.nl                         | ❌ proxy 403           | ⚠️ **403 from the site itself** to curl (one Node fetch got 200). This looks like the site's bot protection, not our proxy. I did not try to get around it. If it persists in Phase 4, download Kenney packs on your machine (commands will be in `scripts/fetch-assets.ts --help`). |
| sketchfab.com / api.sketchfab.com | ❌ proxy 403           | ✅ 200 (the API needs a token for downloads; Phase 4)                                                                                                                                                                                                                                |
| fonts.googleapis.com              | 404 at `/` (reachable) | ✅ 200 for `css2?family=Inter`                                                                                                                                                                                                                                                       |
| download.blender.org              | ❌                     | ✅ 200                                                                                                                                                                                                                                                                               |
| unpkg.com, cdn.jsdelivr.net       | ❌ proxy 403           | not requested (we bundle everything, so no CDNs are needed)                                                                                                                                                                                                                          |
| help.roomsketcher.com             | ❌                     | ⚠️ Cloudflare bot check (403 "Just a moment…"). Not worked around, so RoomSketcher is cited only via search, not opened.                                                                                                                                                             |

Notes:

- Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node ≥ 22.21). `npm run env:check` sets it. The asset scripts will set it too.
- The WebFetch research tool on this machine kept the original network rules. Research pages were therefore opened with Playwright Chromium through the proxy, and their rendered text was read from saved copies.

## Asset tools (deferred: "greybox only for now")

| Tool                 | Status                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gltf-transform CLI   | Not installed. Available from npm (`@gltf-transform/cli` 4.5.1); will be a devDependency in Phase 4.                                                                                           |
| toktx / KTX-Software | Not installed. The release binary is downloadable now that release-assets.githubusercontent.com is allowed (`KTX-Software-4.4.0-Linux-x86_64.tar.bz2` redirect confirmed). Install in Phase 4. |
| Blender headless     | Not installed (optional). download.blender.org is reachable.                                                                                                                                   |

## Repo pipeline status

- Vite 8.3.8 + TypeScript 6.0.3 (strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`). TypeScript 7.0 exists, but typescript-eslint 8.73 requires TS < 6.1 (see DECISIONS.md D-002).
- ESLint 10 (typescript-eslint strict) + Prettier 3.10, Vitest 5.1, Playwright 1.63
- vite-plugin-pwa 2.0 (generateSW; precaches the app shell; manifest + 192/512 icons)
- `vercel.json`: immutable 1-year cache on `/assets/*`, `image/ktx2` and `model/gltf-binary` content types, `sw.js` revalidated on every load
- GitHub Actions `.github/workflows/ci.yml`: format, lint, typecheck, unit, Playwright (Chromium), uploads screenshots/report
- First commit pushed to `claude/modulo-room-setup-6dw6kc`
- Vercel: **waiting on you** (SETUP.md §4)
