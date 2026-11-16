# SETUP.md — reproduce everything locally

## 1. Prerequisites

- Node.js **22.12+** (22 LTS recommended) and npm 10
- git
- (optional, Phase 4) KTX-Software 4.4 (`toktx`), Blender 4.x

```bash
git clone https://github.com/leiffurthersocial-rgb/modulo-room.git
cd modulo-room
git checkout claude/modulo-room-setup-6dw6kc   # until merged to main
npm ci
npx playwright install chromium                 # browser for e2e tests (add `--with-deps` on Linux)
```

## 2. Everyday commands

| Command                                                 | What it does                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                                           | Vite dev server at http://localhost:5173                                        |
| `npm run build`                                         | Typecheck + production build into `dist/` (with service worker)                 |
| `npm run preview`                                       | Serve `dist/` at http://localhost:4173 (PWA/offline testable here)              |
| `npm test`                                              | Vitest unit tests                                                               |
| `npm run e2e`                                           | Playwright: builds, serves, runs desktop + iPad profiles, writes `screenshots/` |
| `npm run lint` / `npm run typecheck` / `npm run format` | Static checks                                                                   |
| `npm run env:check`                                     | Prints tool versions, headless WebGL2 status and host reachability              |

Screenshot mode: open any page with `?screenshot=1` for a deterministic single frame (DPR 1, no animation). Tests wait for `window.__mrReady`.

Testing on a real iPad: `npm run build && npx vite preview --host`, then open `http://<your-computer-ip>:4173` in iPad Safari on the same Wi‑Fi. (Service workers need HTTPS or localhost, so test offline/PWA behaviour on the Vercel URL.)

## 3. Headless WebGL2

Chromium renders WebGL2 in software through ANGLE + SwiftShader. `playwright.config.ts` passes
`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, so CI and every machine get the same rasterizer. Screenshots from a Mac with a GPU still use SwiftShader in tests, which is intended for determinism.

## 4. Deploy to Vercel (one-time, done by you)

1. Sign in at https://vercel.com → **Add New… → Project** → **Import Git Repository** → pick `leiffurthersocial-rgb/modulo-room`. Install the Vercel GitHub app on that repo if asked.
2. Framework preset: **Vite** (also set in `vercel.json`). Build command `npm run build`, output `dist`. No environment variables are needed.
3. Production branch: Vercel uses the repo's **default branch**. The repo currently has no `main`; `claude/modulo-room-setup-6dw6kc` is the only (and default) branch, so every push to it is a **production deployment**. If a `main` branch is created later and made the default (GitHub → Settings → Default branch, and Vercel → Settings → Git → Production Branch), work branches get **Preview deployments** instead.
4. Previews are behind Vercel Authentication by default. To let me (and anyone else with the link) open review builds, either set **Settings → Deployment Protection → Vercel Authentication** to _Only Production Deployments_ / _Disabled_ for previews, or send me the production URL after merging.
5. Send me the deployment URL. I'll verify headers (`/assets/*` immutable cache, `.ktx2 → image/ktx2`) and the offline service worker against it.

Alternative without the dashboard (your machine): `npm i -g vercel && vercel login && vercel link && vercel --prod`.

## 5. Cloud environment used by Claude

The Claude Code cloud session runs on a personal environment named **`modulo-room`** with an exact-host network allowlist (see ENVIRONMENT.md). The research hosts can be removed after STEP 1 if you prefer: claude.ai → Code → environment menu → Edit → Network access.

## 6. Asset pipeline (Phase 4 — not active yet)

These are placeholders so the commands are known in advance. The scripts arrive in Phase 4.

```bash
# KTX-Software (macOS):  brew install ktx      # or the .pkg from github.com/KhronosGroup/KTX-Software/releases
# KTX-Software (Linux):  download KTX-Software-4.4.0-Linux-x86_64.tar.bz2 from the same releases page
npm run assets:fetch     # scripts/fetch-assets.ts → .asset-cache/ (rate-limited, records licenses)
npm run assets:process   # scripts/process-assets.ts → public/assets/ (KTX2 tiers, Draco/meshopt, LODs, thumbnails)
```
