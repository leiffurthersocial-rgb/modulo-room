# Modulo: Room

Browser-based room planner: draw your real room as a 2D floor plan, furnish it at real-world sizes, and see the same model live in 3D. Offline-first PWA for desktop browsers and iPad Safari.

Status: **STEP 0/1 done, waiting for plan approval.** Hello-world pipeline only.

- [PLAN.md](PLAN.md) — phases, milestones, open questions
- [RESEARCH.md](RESEARCH.md) — research with sources, recommended architecture, risks
- [DECISIONS.md](DECISIONS.md) — decision log
- [ENVIRONMENT.md](ENVIRONMENT.md) — environment audit
- [SETUP.md](SETUP.md) — how to reproduce, test and deploy

```bash
npm ci && npm run dev      # http://localhost:5173
npm test && npm run e2e    # unit + Playwright (desktop & iPad profiles)
```
