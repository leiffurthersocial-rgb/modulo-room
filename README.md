# Modulo: Room

Browser-based room planner: draw your real room as a 2D floor plan, furnish it at real-world sizes, and see the same model live in 3D. Offline-first PWA for desktop browsers and iPad Safari.

Status: **Phase 1 (2D greybox editor) done — in review.** Draw rooms and walls with exact sizes, doors/windows, furniture at real sizes, checks for overlaps / blocked doors / walkways, autosave, JSON/SVG/PNG export. 3D comes in Phase 2.

Try it: open the app → "Open the sample flat", or "Draw a room" and type the inside size.

- [PLAN.md](PLAN.md) — phases, milestones, open questions
- [RESEARCH.md](RESEARCH.md) — research with sources, recommended architecture, risks
- [DECISIONS.md](DECISIONS.md) — decision log
- [ENVIRONMENT.md](ENVIRONMENT.md) — environment audit
- [SETUP.md](SETUP.md) — how to reproduce, test and deploy
- [docs/phase-1-review.md](docs/phase-1-review.md) — Phase 1 summary, screenshots, numbers, open questions

```bash
npm ci && npm run dev      # http://localhost:5173
npm test && npm run e2e    # unit + Playwright (desktop & iPad profiles)
```
