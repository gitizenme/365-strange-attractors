# 365 Strange Attractors — "The Living Archive" Design Spec

**Date:** 2026-07-19
**Status:** Approved pending user review
**Source archive:** `/Users/joe/Pictures/Art/365 Strange Attractors/` (read-only input; never modified)
**Project root:** `/Users/joe/Pictures/Art/365 Strange Attractors/website/`

## 1. Purpose

An interactive art experience presenting the 365 fractal / strange-attractor works Joe created daily throughout 2010. The site is itself a piece of art: visitors explore the collection as a navigable constellation, open individual works, and see the *actual* attractors re-rendered live in WebGL from the original 2010 parameter files. Not a portfolio-with-bio, not a storefront.

**Success criteria:**
- A first-time visitor understands the concept (one attractor per day, 2010) within seconds and can explore without instructions.
- Every one of the 365 works is reachable, viewable at high resolution, and has a shareable URL.
- Live attractor rendering works for every day (all 365 have parameter files); graceful static fallback where rendering fails or WebGL is unavailable.
- Runs at 60fps on a mid-range laptop; usable on mobile with reduced point budgets.

## 2. Source Material (verified present in archive)

| Asset | Location | Notes |
|---|---|---|
| Master renders | `generated/` (373 JPG, ~2096px) and `pngs/` (1024px PNG) | Primary image source: `generated/` |
| Titles/order | `365ImageList.csv` | `NNN/365 Title` per line, 365 entries |
| Chaoscope params | `project/NNN/*.csproj` | 118 files; plain text; types: icon, chaotic_flow, lorenz_84, unravel, lorenz, julia, ifs, polynomial_func, polynomial_c, pickover |
| Incendia params | `project/NNN/*.par` (301) + `ideas/*.par` (40) | Undocumented numeric format; 3D affine IFS transforms discernible |
| Coverage | Every day 001–365 has ≥1 `.par` or `.csproj` in `project/NNN/` | Verified |
| Ephemera | `mosaic/`, `book/`, `animations/`, DVD, proposals | Phase 4 "about" material only |

## 3. Architecture

Fully static site, no backend. Two halves:

### 3.1 Build pipeline (runs locally, output committed/deployed)
1. **Param parser** — parses all `.csproj` and `.par` files into a normalized `attractors.json`: `{ day, system, params, transforms[], sourceFile }`. Chaoscope `.csproj` is structured text (info/attractor/view/gradient blocks, CRLF). Incendia `.par` is positional numeric; parse the affine transform matrices + weights; unknown fields ignored.
2. **Image analysis** — for each of the 365 renders: dominant palette (k-means, 5 swatches), mean brightness, hue histogram, and a visual embedding; UMAP projects embeddings to 2D constellation coordinates. Output: `artworks.json`: `{ day, slug, title, palette[], brightness, x, y }`.
3. **Image derivatives** — from `generated/` masters: AVIF/WebP/JPEG at 2000px, 1024px, 256px; plus a single 64px texture atlas (`atlas.png` + UV manifest) for the constellation sprites.
4. **Page generation** — 365 prerendered HTML pages `/day/NNN-slug/` with title, image, caption, OpenGraph tags; hydrate into the app.

### 3.2 Web app
- **Stack:** Vite + TypeScript + Three.js. Plain-TS DOM overlay (no UI framework). Client-side router over the prerendered pages.
- **Scenes:** one WebGL canvas hosting two modes — Constellation and Piece view — with camera-driven transitions (no page reloads).
- **Attractor engine:** GPU point-cloud renderer, one shared accumulation/render path with pluggable per-family step functions: lorenz, lorenz_84, pickover, julia, ifs, chaotic_flow, polynomial (func/c), icon, unravel, incendia-ifs. Points iterated in shaders (transform-feedback or ping-pong FBO), additive blending, palette-tinted.
- **Audio engine:** Web Audio API synthesis only (no samples). Off by default; speaker toggle.

## 4. Experience Design

### 4.1 Constellation (default view)
- Dark space; 365 works as glowing thumbnail sprites positioned by UMAP similarity — color/mood clusters emerge naturally. Slow ambient drift. Intro title card fades after a few seconds (first visit only).
- Zoom (scroll/pinch) and pan (drag), inertial, softly bounded. Sprites resolve 64px → 256px as you approach; nearby labels (day + title) fade in.
- Hover: sprite swells slightly + faint particle shimmer in its palette colors.
- **Time view** toggle: layout reflows into a 365-position year spiral (chronological), with constellation lines between adjacent days; toggle back reflows to clusters.
- Orientation: corner minimap; search box (day number or title fragment); "Index" button opens a simple 12-month calendar grid overlay (DOM, accessible) — every cell links to its piece URL.

### 4.2 Piece view
- Click a sprite → camera glides in, constellation dims, high-res 2010 render fades up centered. Around/behind it the live attractor materializes: 1–4M GPU points from the day's actual parameters, slowly rotating, palette-tinted. Caption: day, title, 2010 date, system family.
- Drag to orbit the live attractor; scroll to dive in.
- **Disturb** gesture: press-and-hold injects a small parameter perturbation; attractor visibly reshapes, then eases back to the authentic values.
- Toggles: hide static render (full-screen live); share/download.
- Prev/next day (arrows/swipe): same-family neighbors **morph** via parameter interpolation; cross-family transitions dissolve/re-condense the point cloud. No hard cuts.
- Rendering stance: point clouds are the attractor's "living skeleton," not a replica of Incendia/Chaoscope's volumetric/gas renders. The 2010 render remains the artwork of record.

### 4.3 Audio (opt-in)
- **Constellation:** quiet drone; pitch center/timbre drift with position in color space; zoom velocity → filter movement. Hover chime per artwork: hue → pitch class, brightness → octave.
- **Piece:** attractor dynamics modulate sound — mean point velocity → shimmer rate, spatial spread → stereo width/reverb, flow period → slow LFO. Disturb pushes toward dissonance, resolves on relaxation.
- **Morph:** signature tones crossfade during interpolation.
- Scope guard: one drone voice + one chime voice + few mappings. Simplify if it competes with visuals.

### 4.4 Fallbacks & accessibility
- No WebGL / `prefers-reduced-motion`: static experience — calendar index + static piece pages remain fully functional and beautiful.
- Audio always off by default; `prefers-reduced-motion` also suppresses ambient drift.
- All navigation reachable by keyboard; images have alt text (title + system family).
- Mobile: point budget scaled by `devicePixelRatio`/GPU tier; touch equivalents for all gestures.

## 5. URLs & SEO
- `/` — constellation. `/day/NNN-slug/` — prerendered piece pages (title, OpenGraph image, caption) that hydrate into the app. `/index/` — calendar grid. `/about/` — the 2010 story + ephemera (phase 4).

## 6. Error Handling
- Pipeline: a param file that fails to parse → recorded in `attractors.json` as `{ system: "unparsed" }`; build still succeeds; CI reports count. Piece view for unparsed days shows static render only (design tolerates this).
- Runtime: attractor iteration diverging (NaN/escape) → engine clamps and restarts from seed; if repeated, falls back to static.
- Missing image/asset → placeholder swatch from palette; console diagnostic.

## 7. Testing
- **Pipeline unit tests:** parsers verified against known files (e.g. day 001 `chaotic_flow` params match file contents; a parsed Lorenz produces a bounded orbit numerically). Completeness test: 365 days each have title, image set, coordinates, and attractor entry.
- **Renderer:** per-family visual verification against 2010 renders (manual, once per family); automated smoke test that each family's step function produces non-degenerate point spread.
- **CI:** build pipeline + app build + tests on every push.

## 8. Phased Delivery (each phase ships)
1. **Static constellation:** pipeline (images, analysis, layout, pages), constellation + piece view with static images, time view, index, URLs, ambient motion.
2. **Live engine:** Chaoscope families first, then Incendia IFS; disturb; morphs.
3. **Audio layer.**
4. **Polish:** about page + ephemera, mobile tuning, performance passes.

## 9. Risks
- **Incendia `.par` format** is undocumented; reverse-engineering may leave some days unparsed → tolerated by design (static fallback), tracked as a count we drive down.
- **Mobile GPU limits** → tiered point budgets (250k/1M/4M).
- **UMAP layout quality** is aesthetic; may need manual nudging → pipeline supports a `layout-overrides.json`.
