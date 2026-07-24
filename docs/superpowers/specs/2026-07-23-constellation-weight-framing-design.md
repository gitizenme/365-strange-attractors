# Constellation Weight + Framing — Design Spec

**Date:** 2026-07-23
**Status:** Approved pending user review
**Project root:** `/Users/joe/Pictures/Art/365 Strange Attractors/website/`
**Parent context:** Pass A (second of four improvement passes from the 2026-07-21 live-site
audit; pass 1 "shareability quick wins" shipped 2026-07-22).

## 1. Purpose

Cut the landing page's cold load from 23.6 MB to ~350 KB and make the constellation
open composed instead of small, off-center, and clipped.

Measured today (cold load of chaosofzen.dev):
- `images/atlas.png` — 12.5 MB PNG (2560×2432, 128px tiles); sprites invisible until it
  fully arrives (~2 s on fast broadband, 20–40 s on cellular).
- ~45 requests / ~9.8 MB of 1200px Apple-CDN album art + 198 requests / 1.9 MB of index
  thumbnails, all triggered at boot because `MusicView` and `IndexView` DOM is constructed
  eagerly in `main.ts` even though both views start closed.
- Camera parked at fixed `(0, 0, 120)` regardless of viewport or cloud position
  (`constellation.ts:46`); pan clamp hardcoded to ±60 world units around the origin
  (`controls.ts:9`) though the UMAP cloud is not origin-centered.

**Success criteria:**
- Cold first meaningful paint (visible constellation) ≤ ~500 KB transferred: app code
  (~146 KB) + JSON (~38 KB) + small atlas (target ≲150 KB).
- Zero index-thumbnail and zero Apple-CDN requests until the visitor opens Index/Music.
- On any viewport (desktop, mobile portrait/landscape) the cloud opens centered, filling
  ~85% of the limiting dimension, nothing clipped; reframes on resize/rotate until the
  visitor first pans or zooms.
- Full-resolution sprites arrive as a seamless background upgrade (single-frame texture
  swap, no flicker or layout shift).
- Sprites and minimap visibly brighter/readable (polish items, judged live).

## 2. Decisions (settled with user)

- **Atlas: blur-up, two tiers.** `atlas-32.webp` (32px tiles) loads first — whole
  constellation as soft glowing forms in a few hundred ms; `atlas-128.webp` (128px tiles,
  quality ~78) swaps in when ready. Linear filtering makes the small tier read as
  intentional blur. PNG atlas no longer emitted.
- **Framing: fit whole cloud, centered,** ~85% fill of the limiting viewport dimension.
  No drift-in animation, no overflow framing.
- **Scope extras: both polish items in** — sprite brightness lift and minimap visibility.

**Out of scope:** about page, piece-view affordances, audio, any change to piece-view
image loading (256/1024/2000px derivatives unchanged).

## 3. Architecture

### 3.1 Pipeline (`pipeline/images.mjs`, `buildAtlas`)

- Emits `public/images/atlas-32.webp` and `public/images/atlas-128.webp` from the same
  tile compositing loop, parameterized by tile size (32 → 640×608; 128 → 2560×2432 for
  373 tiles at 20 columns). WebP quality ~78 for the 128 tier; the 32 tier may use a
  higher quality (it is tiny regardless; tune so it stays ≲150 KB).
- `public/data/atlas.json` gains `files: { small: "/images/atlas-32.webp", full:
  "/images/atlas-128.webp" }` alongside the existing `{ tile, cols, rows, index }`.
  `tile` refers to the full tier. UV math (`atlasUv`) is resolution-independent and
  unchanged.
- `atlas.png` is no longer written. (The stale copy on the live site is overwritten /
  removed by the content deploy's rsync --delete.)

### 3.2 Client — atlas loading (`src/constellation.ts`, `src/data.ts`)

- `Atlas` type gains `files: { small: string; full: string }`.
- Constructor loads `files.small` via TextureLoader as the initial `uAtlas` texture
  (sRGB, linear filtering — as today).
- Immediately also starts loading `files.full`; `onLoad` swaps the `uAtlas` uniform's
  value and disposes the small texture. Failure of the full tier → `console.warn`, stay
  on small tier (site fully functional, just soft).
- No other shader/geometry changes for loading.

### 3.3 Client — lazy views (`src/main.ts`)

- `IndexView` and `MusicView` construction moves out of boot into the router callback:
  built on first `index` / `music` route hit, cached in a local for subsequent opens.
- `music.json` still fetched at boot (7 KB) — the Music button's existence logic and all
  spec-§6 failure-isolation guarantees are preserved verbatim; the existing
  MusicView try/catch moves with the construction (a constructor throw on first open
  disables the section from then on, same behavior class as today).
- Keyboard handler and router references switch to the nullable/lazy locals
  (`index?.isOpen()` pattern, mirroring the existing `music?.` pattern).

### 3.4 Client — framing (`src/controls.ts`, `src/main.ts`)

- New pure function (in `controls.ts`, exported):
  `fitCamera(bounds: {minX,maxX,minY,maxY}, aspect: number, fovDeg: number, fill = 0.85)
  → {x, y, z}` — centers on the bounds and chooses `z` so the box fills `fill` of the
  limiting dimension (accounts for aspect: width limited vs height limited).
- Cloud bounds computed once at boot from artwork positions — union of the UMAP layout
  and the time-spiral layout, padded ~10%, so Time mode stays in frame too.
- Applied before the first rendered frame; re-applied on `resize` until the first user
  pan/zoom (a `userMoved` flag in Controls set by pointer-drag and wheel), never after.
- Controls clamp derives from the same bounds: `clampCamera` gains a center + extent
  (replacing hardcoded ±60), `zMax = fitted z × 1.1` (can always zoom out to home
  framing), `zMin` unchanged (4).
- `flyTo`/deep-link behavior unchanged (day deep links fly to the piece as today).

### 3.5 Client — polish

- **Sprite brightness** (`src/constellation.ts` FRAG): `gl_FragColor.rgb` multiplied by
  a `uBrightness` uniform, constant 1.25, result clamped to 1.0 per channel. No UI.
- **Minimap** (`src/minimap.ts`): dots drawn in each artwork's first palette color at
  fuller opacity; a stroked rectangle tracking the camera's visible world-rect; a subtle
  1px border on the map itself. Self-contained.

## 4. Error handling

- Pipeline: unchanged failure modes (source images are build inputs; sharp errors fail
  the build loudly).
- Client: small-atlas load failure behaves exactly like today's atlas failure (WebGL
  constructor try/catch → static fallback). Full-atlas failure → warn + stay on small.
- Old-client/new-data skew: avoided entirely — `scripts/deploy.sh` rsyncs the whole
  built `dist/` (new code AND new atlases/JSON, removing the obsolete `atlas.png`) in a
  single push, so client and data always match on the live site (§6). We deliberately do
  NOT keep emitting `atlas.png` as a fallback; the 12.5 MB file is the thing being
  deleted.

## 5. Testing

House convention: pure functions unit-tested; DOM/GL verified live in the browser
(established during the music section — no jsdom).

- `fitCamera`: wide vs tall aspect, fill factor, degenerate single-point bounds,
  z clamped positive.
- Bounds derivation: union of UMAP + spiral positions, padding applied.
- `clampCamera` with center+extent (existing tests updated).
- Pipeline: `buildAtlas` emits both WebPs with correct dimensions and a manifest with
  `files`, `tile`, correct `rows/cols/index` (extend existing atlas/images tests).
- Live verification: blur-up sequence observed, texture swap flicker-free, network panel
  shows no thumbnail/album-art requests until Index/Music opened, framing correct on
  desktop + mobile presets + rotation, brightness/minimap judged visually.

## 6. Deploy

1. Merge the code+pipeline PR. (CI's code-only deploy runs but is harmless: the old
   live data still satisfies neither client fully for a few minutes — see step 2.)
2. Immediately run `npm run pipeline` locally (regenerates both atlases + atlas.json),
   then `scripts/deploy.sh` — one atomic push of the whole built `dist/`: new code, new
   atlases, new JSON, and (via rsync --delete) removal of the obsolete 12.5 MB
   `atlas.png`. After this push, client and data match exactly.
3. Verify live immediately: blur-up sequence, full-res swap, framing on desktop + mobile,
   no thumbnail/album-art requests until Index/Music opened.
