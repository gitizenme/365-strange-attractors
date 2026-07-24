# 365 Strange Attractors — chaosofzen.dev

One strange attractor a day, every day of 2010 — 365 fractal works by Joe Chavez, presented
as an explorable 3D constellation. Each piece re-renders live in the browser from its
original 2010 parameter file where the attractor family could be faithfully re-simulated.

**Live:** https://chaosofzen.dev

## Status — 2026-07-23

| Pass | State |
|---|---|
| Shareability (meta/OG/favicons/sitemap/robots) | Shipped — PRs #16–#18 (2026-07-22) |
| Constellation weight + framing (23.6 MB → ~296 KB cold load, two-tier WebP atlas, real camera fit, lazy views) | Shipped — PR #19 |
| Navigation redesign ("living nav": Today · Attractors · Sound · Story word-row, daily arrival settle, veil views, piece-action vocabulary, route shells) | Shipped — PR #20, deployed 2026-07-23 |
| Story page content (the 2010 story) | Next — nav slot + interim page live; needs the artist's text |
| Per-day audio (AttractorSonifier) | Future — Listen slot designed in; all 365 days composed, audio production pending |

Deferred follow-ups live in `.superpowers/sdd/progress.md` (headline: `flyTo` should resolve
a `landed` boolean; consider a `404.html` app shell so legacy deep links work as direct hits).

## Architecture

- **`src/`** — Vite + TypeScript + Three.js app. `main.ts` boots the constellation
  (`constellation.ts`, instanced sprite cloud over a two-tier WebP atlas), camera
  (`controls.ts`), word-row nav (`nav.ts`), router (`router.ts`: `/`, `/day/:slug/`,
  `/today/`, `/attractors/`, `/sound/`, `/story/` + legacy redirects), daily arrival
  (`today.ts`), views (`piece.ts`, `indexview.ts`, `musicview.ts`, `storyview.ts`), and
  live attractor re-simulation (`attractor/`).
- **`pipeline/`** — Node build over the parent art archive (`../`): image derivatives,
  atlases, data JSON, per-day static pages, route shells, sitemap, OG/favicons. The repo
  must stay nested inside the archive — `build.mjs` resolves `ARCHIVE = resolve('..')`.
- **`tests/`** — Vitest. House convention: pure functions get unit tests; DOM/GL behavior
  is verified live in the browser.

## Commands

```
npm run dev        # Vite dev server
npm test           # vitest run
npm run pipeline   # regenerate public/ from the archive (images, data, pages, sitemap)
npm run build      # production build into dist/
scripts/deploy.sh  # full content deploy to chaosofzen.dev (see below)
```

## Deploy

Two channels, both required for a full release:

1. **CI** ships tracked files (code, tracked data) on every green push to `main` — harmless
   but incomplete alone.
2. **`scripts/deploy.sh`** ships the whole built `dist/` (including gitignored pipeline
   output: images, day pages, route shells) from a machine that has run `npm run pipeline`.
   One atomic rsync push so client and data always match.
