# Constellation Weight + Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the landing page's cold load from 23.6 MB to ~350 KB (blur-up two-tier atlas, lazy Index/Music view construction) and make the constellation open centered and fully framed on any viewport instead of small, off-center, and clipped.

**Architecture:** `pipeline/images.mjs` emits two WebP atlases (32px and 128px tiles) instead of one 12.5 MB PNG; `src/constellation.ts` loads the small tier first and swaps to the full tier when it arrives. A new pure `fitCamera` (in `src/controls.ts`) and `computeCloudBounds` (in `src/constellation.ts`) replace the fixed `(0,0,120)` camera start and hardcoded `±60` pan clamp with real cloud-bounds-derived framing, applied at boot and on resize until the visitor's first pan/zoom. `IndexView`/`MusicView` construction moves from eager (at boot) to lazy (first route hit), eliminating ~11.7 MB of requests that today fire before either view is ever opened.

**Tech Stack:** Vite, TypeScript, Vitest (`npm test` = `vitest run`), Three.js, `sharp` (pipeline image processing) — same stack as the rest of this repo, no new dependencies.

## Global Constraints

- No PNG atlas emitted any more — `atlas.png` is fully replaced by `atlas-32.webp` + `atlas-128.webp` (spec §2).
- Framing fits the **whole cloud, centered**, at ~85% fill of the limiting viewport dimension — no drift-in animation, no overflow framing (spec §2).
- Both polish items are in scope: sprite brightness lift and minimap visibility (spec §2).
- Out of scope: about page, piece-view affordances, audio, any change to piece-view image loading — the 256/1024/2000px per-artwork derivatives (`makeDerivatives`) are untouched (spec §2).
- `music.json` (7 KB) still fetches at boot; only `MusicView`'s DOM construction (and the Apple Music CDN image requests that construction triggers) becomes lazy (spec §3.3).
- `flyTo`/deep-link behavior (day pages) is unchanged — this plan only touches the *home* camera framing, not piece navigation (spec §3.4).
- House testing convention (established during the music-section work, recorded in `.superpowers/sdd/progress-music-section-archived.md`): pure functions get unit tests; DOM/GL/canvas rendering is verified live in the browser. No jsdom.
- Every pure-function change in this plan is TDD'd (red → green). Every DOM/GL/canvas change is manual-verified in Task 9's checklist — no automated test is skipped silently.

---

### Task 1: Pipeline — two-tier WebP atlas

**Files:**
- Modify: `pipeline/images.mjs` (full file, 37 lines today)
- Test: `tests/images.test.mjs:29-39` (the `buildAtlas` describe block)
- Test: `tests/completeness.test.mjs:22-25` (the `'atlas covers every slug'` test)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `buildAtlas(items, outRoot)` now returns/writes `{ tile: 128, cols: 20, rows, index, files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' } }` and writes `images/atlas-32.webp` + `images/atlas-128.webp` (no more `images/atlas.png`). Task 2's `Atlas` type and `Constellation` constructor consume the `files` field by name.

- [ ] **Step 1: Write the failing test**

Replace the `buildAtlas` describe block in `tests/images.test.mjs` (currently lines 29-39):

```js
describe('buildAtlas', () => {
  it('composites both tiers and writes a manifest with files', async () => {
    const items = [{ slug: '001-rose', srcPath: src }, { slug: '002-x', srcPath: src }];
    const manifest = await buildAtlas(items, dir);
    expect(manifest).toEqual({
      tile: 128, cols: 20, rows: 1, index: { '001-rose': 0, '002-x': 1 },
      files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' },
    });
    const full = await sharp(join(dir, 'images', 'atlas-128.webp')).metadata();
    expect(full.width).toBe(20 * 128);
    expect(full.height).toBe(128);
    const small = await sharp(join(dir, 'images', 'atlas-32.webp')).metadata();
    expect(small.width).toBe(20 * 32);
    expect(small.height).toBe(32);
    expect(JSON.parse(readFileSync(join(dir, 'data', 'atlas.json'), 'utf8'))).toEqual(manifest);
  });
});
```

Also update `tests/completeness.test.mjs`'s atlas test (currently lines 22-25) — this one only runs against real pipeline output (`describe.skipIf(!existsSync(DATA))`), so it stays red/skipped until Task 9, but write it now:

```js
  it('atlas covers every slug and emits both webp tiers, no leftover png', () => {
    const atlas = JSON.parse(readFileSync('public/data/atlas.json', 'utf8'));
    for (const a of art) expect(atlas.index[a.slug]).toBeGreaterThanOrEqual(0);
    expect(atlas.files.small).toBe('/images/atlas-32.webp');
    expect(atlas.files.full).toBe('/images/atlas-128.webp');
    expect(existsSync('public/images/atlas-32.webp')).toBe(true);
    expect(existsSync('public/images/atlas-128.webp')).toBe(true);
    expect(existsSync('public/images/atlas.png')).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.mjs`
Expected: FAIL — `expect(manifest).toEqual(...)` mismatch (`files` is `undefined`, and `atlas-128.webp`/`atlas-32.webp` don't exist yet — the old code still writes `atlas.png`).

- [ ] **Step 3: Implement**

Replace the full contents of `pipeline/images.mjs`:

```js
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [2000, 1024, 256];
const COLS = 20;
const TILE_FULL = 128;
const TILE_SMALL = 32;

export async function makeDerivatives(srcPath, slug, outRoot) {
  for (const size of SIZES) {
    const dir = join(outRoot, 'images', String(size));
    mkdirSync(dir, { recursive: true });
    const base = sharp(srcPath).resize({ width: size, withoutEnlargement: true });
    await base.clone().avif({ quality: 55 }).toFile(join(dir, `${slug}.avif`));
    await base.clone().webp({ quality: 78 }).toFile(join(dir, `${slug}.webp`));
    await base.clone().jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, `${slug}.jpg`));
  }
}

async function compositeAtlas(items, tile, outPath, quality) {
  const rows = Math.ceil(items.length / COLS);
  const composites = [];
  for (let i = 0; i < items.length; i++) {
    const buf = await sharp(items[i].srcPath)
      .resize(tile, tile, { fit: 'cover' }).png().toBuffer();
    composites.push({ input: buf, left: (i % COLS) * tile, top: Math.floor(i / COLS) * tile });
  }
  await sharp({ create: { width: COLS * tile, height: rows * tile, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites).webp({ quality }).toFile(outPath);
  return rows;
}

// Two tiers from the same tile-compositing loop: a tiny 32px-tile atlas that loads first (whole
// constellation as soft glowing forms in a few hundred ms, even on cellular) and a 128px-tile
// atlas that swaps in when ready (src/constellation.ts owns the swap). No PNG atlas is written
// any more -- the single 12.5 MB atlas.png this replaces was the single biggest blocker to first
// paint (sprites stayed invisible until it fully arrived).
export async function buildAtlas(items, outRoot) {
  const index = {};
  items.forEach((it, i) => { index[it.slug] = i; });
  mkdirSync(join(outRoot, 'images'), { recursive: true });
  mkdirSync(join(outRoot, 'data'), { recursive: true });
  const rows = await compositeAtlas(items, TILE_FULL, join(outRoot, 'images', 'atlas-128.webp'), 78);
  await compositeAtlas(items, TILE_SMALL, join(outRoot, 'images', 'atlas-32.webp'), 85);
  const manifest = {
    tile: TILE_FULL, cols: COLS, rows, index,
    files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' },
  };
  writeFileSync(join(outRoot, 'data', 'atlas.json'), JSON.stringify(manifest));
  return manifest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.mjs`
Expected: PASS, 2/2 (`makeDerivatives` untouched, `buildAtlas` green).

- [ ] **Step 5: Commit**

```bash
git add pipeline/images.mjs tests/images.test.mjs tests/completeness.test.mjs
git commit -m "feat: pipeline emits two-tier WebP atlas instead of one PNG"
```

---

### Task 2: Client — `Atlas` type + blur-up atlas loading

**Files:**
- Modify: `src/data.ts:5` (the `Atlas` interface)
- Modify: `src/constellation.ts:74-79` (texture loading in the constructor)
- Modify: `tests/constellation.test.ts:4` (the test fixture)

**Interfaces:**
- Consumes: `manifest.files` shape from Task 1 (`{ small: string; full: string }`).
- Produces: `Atlas` gains `files: { small: string; full: string }`. `Constellation`'s constructor now loads `atlas.files.small` first and swaps to `atlas.files.full` on arrival — no new exported symbols; this is internal to the constructor.

No automated test for the texture-swap behavior itself (GL/canvas, house convention — verified live in Task 9). The one thing that IS type-checked here is the `Atlas` interface change, which breaks `tests/constellation.test.ts`'s fixture; fixing that fixture is this task's "test".

- [ ] **Step 1: Update the type and see it break**

In `src/data.ts`, change line 5:

```ts
export interface Atlas { tile: number; cols: number; rows: number; index: Record<string, number>; files: { small: string; full: string } }
```

Run: `npx tsc --noEmit`
Expected: FAIL — `tests/constellation.test.ts:4`'s `atlas` object literal is missing the required `files` property (`Property 'files' is missing in type ... but required in type 'Atlas'`).

- [ ] **Step 2: Fix the fixture**

In `tests/constellation.test.ts`, change line 4:

```ts
const atlas = { tile: 128, cols: 20, rows: 19, index: { '001-rose': 0, '002-x': 21 }, files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' } };
```

- [ ] **Step 3: Run tsc and the test to verify green**

Run: `npx tsc --noEmit && npx vitest run tests/constellation.test.ts`
Expected: tsc clean; test PASS, 1/1 (`atlasUv` itself is unaffected by `files`).

- [ ] **Step 4: Implement the blur-up loading**

In `src/constellation.ts`, replace lines 74-79:

```ts
    const tex = new THREE.TextureLoader().load('/images/atlas.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: tex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
    });
```

with:

```ts
    const smallTex = new THREE.TextureLoader().load(atlas.files.small);
    smallTex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: smallTex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
    });
    // Full-resolution tile atlas loads in the background and swaps in on arrival (single-frame
    // texture-uniform swap, no geometry/shader change) -- the preview tier above is already
    // visible by then, so this reads as a seamless upgrade, not a pop-in. Disposing the old
    // (small) texture frees its GPU memory once nothing references it any more.
    new THREE.TextureLoader().load(
      atlas.files.full,
      fullTex => {
        fullTex.colorSpace = THREE.SRGBColorSpace;
        const old = this.material.uniforms.uAtlas.value as THREE.Texture;
        this.material.uniforms.uAtlas.value = fullTex;
        old.dispose();
      },
      undefined,
      err => console.warn('full-resolution atlas failed to load, staying on the preview tier', err),
    );
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass (no new automated coverage in this step — see Task 9 for live verification of the blur-up sequence and flicker-free swap).

- [ ] **Step 6: Commit**

```bash
git add src/data.ts src/constellation.ts tests/constellation.test.ts
git commit -m "feat: Atlas gains two-tier files, Constellation loads small then swaps to full"
```

---

### Task 3: `fitCamera` + `computeCloudBounds` pure functions

**Files:**
- Modify: `src/controls.ts` (add `Bounds` interface + `fitCamera`, after `clampCamera`)
- Modify: `src/constellation.ts` (add `computeCloudBounds`, near `atlasUv`)
- Test: `tests/controls.test.ts` (new `describe('fitCamera', ...)`)
- Test: `tests/constellation.test.ts` (new `describe('computeCloudBounds', ...)`)

**Interfaces:**
- Consumes: `spiralPosition` from `src/timeview.ts` (already exists, already imported by `constellation.ts`).
- Produces:
  - `interface Bounds { minX: number; maxX: number; minY: number; maxY: number }` (exported from `controls.ts`).
  - `fitCamera(bounds: Bounds, aspect: number, fovDeg: number, fill?: number): { x: number; y: number; z: number }` — centers on `bounds`, chooses `z` so the box fills `fill` (default 0.85) of whichever screen dimension is limiting. Task 4 imports this into `Controls`; Task 5 imports it into `main.ts`.
  - `computeCloudBounds(artworks: { day: number; x: number; y: number }[]): Bounds` — union of each artwork's UMAP position (`x`,`y`) and its time-spiral position (`spiralPosition(day)`), padded ~10% on each axis. Task 5 calls this once at boot with the real `artworks` array.

This task is purely additive — nothing existing calls these yet, so there's no integration risk here (Task 4/5 wire them in).

- [ ] **Step 1: Write the failing tests**

Add to `tests/controls.test.ts` (after the existing `clampCamera` describe block):

```ts
function visibleSize(z: number, aspect: number, fovDeg: number) {
  const h = 2 * z * Math.tan((fovDeg * Math.PI) / 360);
  return { w: h * aspect, h };
}

describe('fitCamera', () => {
  it('centers on bounds regardless of aspect', () => {
    const bounds = { minX: -10, maxX: 30, minY: -4, maxY: 6 };
    const fit = fitCamera(bounds, 1.5, 50);
    expect(fit.x).toBe(10);
    expect(fit.y).toBe(1);
  });

  it('is height-limited for a wide viewport with square bounds', () => {
    const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    const fit = fitCamera(bounds, 2, 50, 0.85);
    const vis = visibleSize(fit.z, 2, 50);
    expect(vis.h).toBeCloseTo(20 / 0.85, 5);
    expect(vis.w).toBeGreaterThan(20 / 0.85); // extra width unused, nothing clipped
  });

  it('is width-limited for a tall viewport with square bounds', () => {
    const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    const fit = fitCamera(bounds, 0.5, 50, 0.85);
    const vis = visibleSize(fit.z, 0.5, 50);
    expect(vis.w).toBeCloseTo(20 / 0.85, 5);
    expect(vis.h).toBeGreaterThan(20 / 0.85);
  });

  it('scales z inversely with fill factor', () => {
    const bounds = { minX: -10, maxX: 10, minY: -5, maxY: 5 };
    const loose = fitCamera(bounds, 1, 50, 0.5);
    const tight = fitCamera(bounds, 1, 50, 1.0);
    expect(loose.z).toBeGreaterThan(tight.z);
    expect(loose.z / tight.z).toBeCloseTo(1.0 / 0.5, 5);
  });

  it('clamps z to a positive minimum for degenerate single-point bounds', () => {
    const fit = fitCamera({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, 1.5, 50);
    expect(fit.z).toBeGreaterThan(0);
    expect(Number.isFinite(fit.z)).toBe(true);
    expect(fit.x).toBe(5);
    expect(fit.y).toBe(5);
  });
});
```

Add the import at the top of `tests/controls.test.ts`:

```ts
import { stepInertia, clampCamera, zoomToward, fitCamera } from '../src/controls';
```

Add to `tests/constellation.test.ts` (after the existing `atlasUv` describe block):

```ts
import { spiralPosition } from '../src/timeview';
import { computeCloudBounds } from '../src/constellation';

describe('computeCloudBounds', () => {
  it('unions UMAP and spiral positions, then pads by ~10%', () => {
    const artworks = [
      { day: 1, x: 20, y: 0 },
      { day: 90, x: -5, y: -3 },
    ];
    const s1 = spiralPosition(1), s2 = spiralPosition(90);
    const rawMinX = Math.min(20, -5, s1.x, s2.x);
    const rawMaxX = Math.max(20, -5, s1.x, s2.x);
    const rawMinY = Math.min(0, -3, s1.y, s2.y);
    const rawMaxY = Math.max(0, -3, s1.y, s2.y);
    const padX = (rawMaxX - rawMinX) * 0.1;
    const padY = (rawMaxY - rawMinY) * 0.1;

    const bounds = computeCloudBounds(artworks);
    expect(bounds.minX).toBeCloseTo(rawMinX - padX, 5);
    expect(bounds.maxX).toBeCloseTo(rawMaxX + padX, 5);
    expect(bounds.minY).toBeCloseTo(rawMinY - padY, 5);
    expect(bounds.maxY).toBeCloseTo(rawMaxY + padY, 5);
  });

  it('includes the spiral point even when the UMAP point sits near the origin (Time mode stays in frame)', () => {
    const artworks = [{ day: 365, x: 0, y: 0 }]; // spiralPosition(365) is near (0, 50) -- see tests/timeview.test.ts
    const bounds = computeCloudBounds(artworks);
    expect(bounds.maxY).toBeGreaterThan(40);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/controls.test.ts tests/constellation.test.ts`
Expected: FAIL — `fitCamera`/`computeCloudBounds` are not exported (`Failed to resolve import` / `is not a function`).

- [ ] **Step 3: Implement `fitCamera`**

In `src/controls.ts`, add after `clampCamera` (currently ends at line 15), before `zoomToward`:

```ts
export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

// Centers the camera on `bounds` and picks a distance (z) so the box fills `fill` of whichever
// screen dimension is more constraining -- the same "letterboxed contain" fit as CSS
// object-fit:contain, computed from the camera's own vertical FOV the way worldPerPixel already
// does below. Never clips: the non-limiting dimension ends up with unused space instead.
export function fitCamera(bounds: Bounds, aspect: number, fovDeg: number, fill = 0.85): { x: number; y: number; z: number } {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);
  const zForHeight = bh / fill / (2 * tanHalfFov);
  const zForWidth = bw / fill / (2 * tanHalfFov * aspect);
  const MIN_FIT_Z = 4; // matches Controls' own zMin -- never fit closer than the visitor can zoom
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: Math.max(zForHeight, zForWidth, MIN_FIT_Z),
  };
}
```

- [ ] **Step 4: Implement `computeCloudBounds`**

In `src/constellation.ts`, add after `atlasUv` (currently ends at line 11), before the `VERT` shader constant:

```ts
import type { Bounds } from './controls';

// Union of the UMAP layout (a.x, a.y) and the time-spiral layout (spiralPosition(a.day)),
// padded ~10% on each axis. Padded so the visitor never sees content flush against the edge, and
// unioned (not just UMAP) so switching to Time mode never pushes sprites out of frame -- the
// spiral's radius (up to 50, see spiralPosition) doesn't always agree with the UMAP layout's own
// extent.
export function computeCloudBounds(artworks: { day: number; x: number; y: number }[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of artworks) {
    const s = spiralPosition(a.day);
    for (const p of [{ x: a.x, y: a.y }, s]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const padX = (maxX - minX) * 0.1, padY = (maxY - minY) * 0.1;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}
```

Note: `import type { Bounds } from './controls';` goes alongside the existing `import type { Artwork, Atlas } from './data';` and `import { spiralPosition } from './timeview';` lines at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run tests/controls.test.ts tests/constellation.test.ts`
Expected: tsc clean; both files PASS (controls: 8/8 total including the 5 new `fitCamera` tests; constellation: 3/3 total including the 2 new `computeCloudBounds` tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/controls.ts src/constellation.ts tests/controls.test.ts tests/constellation.test.ts
git commit -m "feat: add fitCamera and computeCloudBounds pure functions"
```

---

### Task 4: `clampCamera` gains bounds + `Controls` wiring

**Files:**
- Modify: `src/controls.ts:9-15` (`clampCamera` signature), `src/controls.ts:32-121` (`Controls` class)
- Test: `tests/controls.test.ts:15-20` (existing `clampCamera` test — signature changed, not new)

**Interfaces:**
- Consumes: `Bounds`, `fitCamera` from Task 3 (same file, already committed).
- Produces: `clampCamera(p, bounds: Bounds, zMin, zMax)` (was `bounds: number`). `Controls`'s constructor gains a required `bounds: Bounds` parameter (new 3rd positional arg, before `opts`). `Controls` gains `hasUserMoved(): boolean`. Task 5's `main.ts` calls `new Controls(canvas, con.camera, bounds, { reducedMotion })` and reads `controls.hasUserMoved()`.

- [ ] **Step 1: Update the failing test**

In `tests/controls.test.ts`, replace the existing `clampCamera` describe block (lines 15-20):

```ts
describe('clampCamera', () => {
  it('clamps xy independently to a center+extent box and z to range', () => {
    const bounds = { minX: -60, maxX: 60, minY: -30, maxY: 30 };
    expect(clampCamera({ x: 100, y: -100, z: 1 }, bounds, 4, 140)).toEqual({ x: 60, y: -30, z: 4 });
    expect(clampCamera({ x: 0, y: 0, z: 200 }, bounds, 4, 140)).toEqual({ x: 0, y: 0, z: 140 });
  });
});
```

(Asymmetric x/y bounds deliberately, so this test would fail if `clampCamera` still clamped both axes to one shared scalar.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/controls.test.ts`
Expected: FAIL — `clampCamera({...}, bounds, 4, 140)` currently expects `bounds` to be a `number`; with an object passed, `Math.min(bounds, ...)` produces `NaN`, so the result doesn't match `{ x: 60, y: -30, z: 4 }`.

- [ ] **Step 3: Implement — update `clampCamera`**

In `src/controls.ts`, replace lines 9-15:

```ts
export function clampCamera(p: { x: number; y: number; z: number }, bounds: number, zMin: number, zMax: number) {
  return {
    x: Math.min(bounds, Math.max(-bounds, p.x)),
    y: Math.min(bounds, Math.max(-bounds, p.y)),
    z: Math.min(zMax, Math.max(zMin, p.z)),
  };
}
```

with:

```ts
export function clampCamera(p: { x: number; y: number; z: number }, bounds: Bounds, zMin: number, zMax: number) {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)),
    z: Math.min(zMax, Math.max(zMin, p.z)),
  };
}
```

(`Bounds` is already defined above this function from Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/controls.test.ts`
Expected: FAIL still — `Controls`'s own internal calls to `clampCamera` (in `clamp()` and the wheel handler) still pass the old `60`/`140` literals, which won't type-check once `clampCamera` requires `Bounds`. Continue to Step 5 before re-running.

- [ ] **Step 5: Implement — wire `Controls`**

In `src/controls.ts`, change the constructor signature (currently lines 43-44):

```ts
  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera,
              opts: { reducedMotion?: boolean } = {}) {
```

to:

```ts
  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera,
              private bounds: Bounds, opts: { reducedMotion?: boolean } = {}) {
```

Add a `userMoved` field next to the other private fields (currently lines 34-41):

```ts
  private userMoved = false;
```

Add `this.userMoved = true;` as the first line inside the `pointermove` listener's dragging branch (currently lines 53-64) — right after the early-return guard:

```ts
    canvas.addEventListener('pointermove', e => {
      if (!this.enabled) return;
      if (!this.dragging || this.flying) return;
      this.userMoved = true;
      const wpp = worldPerPixel(this.camera, canvas.clientHeight);
```

Add `this.userMoved = true;` in the wheel handler (currently lines 70-78), and replace its clamp call:

```ts
    canvas.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      if (this.flying) return;
      this.userMoved = true;
      const factor = Math.exp(e.deltaY * 0.0015);
      const t = this.screenToWorld(e.clientX, e.clientY);
      const p = zoomToward(this.camera.position, t, factor);
      Object.assign(this.camera.position, clampCamera(p, this.bounds, 4, this.fitZ() * 1.1));
    }, { signal: s, passive: false });
```

Add a `hasUserMoved()` accessor and a private `fitZ()` helper (near `setEnabled`, currently line 81):

```ts
  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  hasUserMoved(): boolean { return this.userMoved; }

  private fitZ(): number {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    return fitCamera(this.bounds, aspect, this.camera.fov, 0.85).z;
  }
```

Replace the existing `private clamp()` method (currently line 91):

```ts
  private clamp() { Object.assign(this.camera.position, clampCamera(this.camera.position, 60, 4, 140)); }
```

with:

```ts
  private clamp() { Object.assign(this.camera.position, clampCamera(this.camera.position, this.bounds, 4, this.fitZ() * 1.1)); }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsc --noEmit && npx vitest run tests/controls.test.ts`
Expected: tsc clean; PASS, 8/8.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass. (No other file constructs `Controls` yet outside `main.ts`, which Task 5 updates next — `tsc --noEmit` across the whole project will actually still fail until Task 5 updates that one call site. If Step 6's project-wide `tsc --noEmit` failed only on `src/main.ts`'s `new Controls(canvas, con.camera, { reducedMotion: reduced.matches })` missing the new `bounds` argument, that's expected and resolved by Task 5 — proceed to commit this task's own files regardless, since `src/controls.ts` and its test are correct in isolation.)

- [ ] **Step 8: Commit**

```bash
git add src/controls.ts tests/controls.test.ts
git commit -m "feat: clampCamera takes real bounds, Controls tracks userMoved and derives zMax from fitCamera"
```

---

### Task 5: Wire framing into `main.ts`

**Files:**
- Modify: `src/main.ts:1-4` (imports), `src/main.ts:22-36` (boot sequence, camera framing)

**Interfaces:**
- Consumes: `computeCloudBounds` (`src/constellation.ts`, Task 3), `fitCamera` (`src/controls.ts`, Task 3), `Controls`'s new `bounds` param + `hasUserMoved()` (Task 4).

No automated test (DOM/GL wiring — see Task 9 for live verification of "framing correct on desktop + mobile presets + rotation").

- [ ] **Step 1: Update imports**

In `src/main.ts`, change lines 2-3:

```ts
import { loadData, loadAttractors } from './data';
import { Constellation } from './constellation';
```

to:

```ts
import { loadData, loadAttractors } from './data';
import { Constellation, computeCloudBounds } from './constellation';
```

Change line 4:

```ts
import { Controls } from './controls';
```

to:

```ts
import { Controls, fitCamera } from './controls';
```

- [ ] **Step 2: Compute bounds and apply framing**

Replace lines 22-36:

```ts
  const [{ artworks, atlas }, attractors, musicData] = await Promise.all([loadData(), loadAttractors(), loadMusicData().catch(() => null)]);
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let con: Constellation;
  try {
    con = new Constellation(canvas, artworks, atlas);
  } catch (err) {
    console.error('WebGL unavailable, falling back to static page', err);
    return; // .static-piece (if present) stays visible; no interactive UI is built
  }
  document.querySelector('.static-piece')?.remove();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  addEventListener('resize', () => con.resize());
  const controls = new Controls(canvas, con.camera, { reducedMotion: reduced.matches });
  reduced.addEventListener('change', () => con.setReducedMotion(reduced.matches));
```

with:

```ts
  const [{ artworks, atlas }, attractors, musicData] = await Promise.all([loadData(), loadAttractors(), loadMusicData().catch(() => null)]);
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const bounds = computeCloudBounds(artworks);
  let con: Constellation;
  try {
    con = new Constellation(canvas, artworks, atlas);
  } catch (err) {
    console.error('WebGL unavailable, falling back to static page', err);
    return; // .static-piece (if present) stays visible; no interactive UI is built
  }
  document.querySelector('.static-piece')?.remove();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  const controls = new Controls(canvas, con.camera, bounds, { reducedMotion: reduced.matches });
  // Fits the whole cloud (UMAP layout union time-spiral layout, padded -- see computeCloudBounds)
  // centered in frame at ~85% of the limiting viewport dimension, replacing the old fixed
  // (0,0,120) camera start. Re-applied on resize/rotate (viewport aspect changed) but only until
  // the visitor's first pan/zoom -- Controls.hasUserMoved() flips permanently on the first drag
  // or wheel event, after which their own framing choice is never overridden from under them.
  const applyFraming = () => {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const fit = fitCamera(bounds, aspect, con.camera.fov, 0.85);
    con.camera.position.set(fit.x, fit.y, fit.z);
  };
  applyFraming();
  addEventListener('resize', () => { con.resize(); if (!controls.hasUserMoved()) applyFraming(); });
  reduced.addEventListener('change', () => con.setReducedMotion(reduced.matches));
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors (this also resolves Task 4 Step 7's deferred project-wide `tsc` gap); all tests pass.

- [ ] **Step 4: Smoke-check in the browser**

```bash
npm run dev
```

Open `http://localhost:5173` — confirm the constellation opens centered and reasonably filling the viewport (not confirming exact 85% yet, just that it's not the old tiny-off-center-cloud state, and no console errors). Full desktop/mobile/rotation verification happens in Task 9 once every task has landed.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire computeCloudBounds/fitCamera into boot, reframe on resize until user moves"
```

---

### Task 6: Lazy `IndexView`/`MusicView` construction

**Files:**
- Modify: `src/main.ts` (the `IndexView`/`indexBtn`/`MusicView`/`musicBtn`/router/keydown/render-loop sections)

**Interfaces:**
- Consumes: nothing new — `IndexView`, `MusicView`, `loadMusicData` are already imported.
- Produces: `index` becomes `IndexView | null` (was a non-null `const`); `music` becomes `MusicView | null | undefined` (was `MusicView | null`) — `undefined` means "not yet attempted", distinguishing it from `null` ("attempted and failed, don't retry"). Every caller of `index.isOpen()`/`index.close()` switches to `index?.`.

No automated test (DOM/GL wiring — see Task 9 for live verification that Index/Music still open/close/switch correctly, and that no thumbnail/album-art requests fire before first open).

- [ ] **Step 1: Replace the IndexView + MusicView + router block**

In `src/main.ts`, find the block from the `IndexView` construction through the end of the `Router` construction (currently lines 109-168):

```ts
  const index = new IndexView(overlay, artworks, slug => {
    index.close();
    router.go({ kind: 'day', slug });
  });
  const indexBtn = document.createElement('button');
  indexBtn.id = 'index-toggle';
  indexBtn.textContent = 'Index';
  indexBtn.title = 'Browse all 365 days (or press /)';
  overlay.appendChild(indexBtn);
  indexBtn.addEventListener('click', () => router.go({ kind: 'index' }));
  addEventListener('keydown', e => {
    if (e.key === '/' && !piece.isOpen() && !index.isOpen() && !music?.isOpen()) { e.preventDefault(); router.go({ kind: 'index' }); }
    if (e.key === 'Escape' && index.isOpen()) router.go({ kind: 'home' });
  });

  // null when /data/music.json failed to load/parse (see the Promise.all above) -- in that case,
  // skip building MusicView and its nav button entirely rather than showing a button that opens
  // nothing, matching spec §6's "shows nothing rather than crashing the rest of the app".
  //
  // The load succeeding (musicData truthy) doesn't guarantee its SHAPE is right, though -- e.g. a
  // music.json missing `artist` would let MusicView's constructor run and throw synchronously the
  // first time it dereferences a missing field. That throw would happen before `const router = new
  // Router(...)` and `requestAnimationFrame(loop)` below, aborting the rest of boot(): no router, no
  // click handling, no animation loop, the whole page frozen non-interactive -- the same failure
  // class as the load-failure case above (MusicView's data problem taking down the entire site), just
  // a different trigger. Wrap construction in try/catch, mirroring the `new Constellation(...)`
  // try/catch a few lines up, so any throw here also just disables the Music section.
  let music: MusicView | null = null;
  if (musicData) {
    try {
      music = new MusicView(overlay, musicData, () => router.go({ kind: 'home' }));
      const musicBtn = document.createElement('button');
      musicBtn.id = 'music-toggle';
      musicBtn.textContent = 'Music';
      musicBtn.title = 'Chaos of Zen discography';
      overlay.appendChild(musicBtn);
      musicBtn.addEventListener('click', () => router.go({ kind: 'music' }));
    } catch (err) {
      console.error('MusicView failed to construct, disabling Music section', err);
      music = null;
    }
  }

  const router = new Router(async r => {
    // music?. -- music is null when musicData failed to load (see above); a deep link to /music/
    // in that case should also just show nothing rather than throw.
    if (r.kind === 'music') { piece.close(); index.close(); music?.open(); return; }
    music?.close();
    if (r.kind === 'index') { piece.close(); index.open(); return; }
    index.close();
    if (r.kind === 'day' && bySlug.has(r.slug)) {
      const i = bySlug.get(r.slug)!;
      const p = con.positionOf(i);
      await controls.flyTo(p.x, p.y, 8, 0.9);
      piece.open(r.slug);
      syncHideImageLabel();
    } else {
      piece.close();
    }
  });
```

Replace it with:

```ts
  // Neither view's DOM is built here any more -- IndexView's ~198 index-thumbnail requests and
  // MusicView's ~45 Apple Music CDN requests (~11.7 MB combined) only fire once a visitor actually
  // opens Index or Music, not on every boot. Both start as null/undefined and are constructed lazily
  // by the router below, on first route hit.
  let index: IndexView | null = null;
  const indexBtn = document.createElement('button');
  indexBtn.id = 'index-toggle';
  indexBtn.textContent = 'Index';
  indexBtn.title = 'Browse all 365 days (or press /)';
  overlay.appendChild(indexBtn);
  indexBtn.addEventListener('click', () => router.go({ kind: 'index' }));
  addEventListener('keydown', e => {
    if (e.key === '/' && !piece.isOpen() && !index?.isOpen() && !music?.isOpen()) { e.preventDefault(); router.go({ kind: 'index' }); }
    if (e.key === 'Escape' && index?.isOpen()) router.go({ kind: 'home' });
  });

  // undefined = not yet attempted; null = attempted and failed (disables the section for the rest
  // of the session, same as before); a MusicView instance = succeeded. null from the start when
  // /data/music.json itself failed to load/parse (see the Promise.all above) -- matches spec §6's
  // "shows nothing rather than crashing the rest of the app" by skipping construction entirely
  // rather than showing a button that opens nothing.
  let music: MusicView | null | undefined = musicData ? undefined : null;
  const musicBtn = document.createElement('button');
  musicBtn.id = 'music-toggle';
  musicBtn.textContent = 'Music';
  musicBtn.title = 'Chaos of Zen discography';
  if (musicData) {
    overlay.appendChild(musicBtn);
    musicBtn.addEventListener('click', () => router.go({ kind: 'music' }));
  }

  const router = new Router(async r => {
    if (r.kind === 'music') {
      piece.close(); index?.close();
      // First hit only (music === undefined): build the view now. A throw here disables the
      // section for the rest of the session (music = null) -- mirroring the try/catch that used
      // to guard eager construction at boot, just deferred to this later trigger. musicData is
      // guaranteed non-null here since music only starts `undefined` (not `null`) when it was.
      if (music === undefined) {
        try {
          music = new MusicView(overlay, musicData!, () => router.go({ kind: 'home' }));
        } catch (err) {
          console.error('MusicView failed to construct, disabling Music section', err);
          music = null;
        }
      }
      music?.open();
      return;
    }
    music?.close();
    if (r.kind === 'index') {
      piece.close();
      (index ??= new IndexView(overlay, artworks, slug => { index!.close(); router.go({ kind: 'day', slug }); })).open();
      return;
    }
    index?.close();
    if (r.kind === 'day' && bySlug.has(r.slug)) {
      const i = bySlug.get(r.slug)!;
      const p = con.positionOf(i);
      await controls.flyTo(p.x, p.y, 8, 0.9);
      piece.open(r.slug);
      syncHideImageLabel();
    } else {
      piece.close();
    }
  });
```

- [ ] **Step 2: Update the render loop's guard**

Find (currently line 190):

```ts
    if (!piece.isOpen() && !index.isOpen() && !music?.isOpen()) {
```

Replace with:

```ts
    if (!piece.isOpen() && !index?.isOpen() && !music?.isOpen()) {
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Smoke-check in the browser**

```bash
npm run dev
```

Open the network panel, reload, confirm zero requests to `music.apple.com`/Apple CDN and zero `/images/256/*.jpg` index-thumbnail requests on initial load. Click Index — thumbnails now load. Navigate home, click Music — album art now loads. Full click-through/back-forward/failure-injection verification happens in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: defer IndexView/MusicView construction to first open"
```

---

### Task 7: Sprite brightness uniform

**Files:**
- Modify: `src/constellation.ts` (the `FRAG` shader constant, the `uniforms` object in the constructor)

**Interfaces:**
- Consumes: nothing.
- Produces: no new exported symbols — internal shader change only.

No automated test (GLSL/GPU rendering — visual, judged live per spec §3.5/§5).

- [ ] **Step 1: Update the fragment shader**

In `src/constellation.ts`, replace the `FRAG` constant:

```ts
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uAtlas, vUv); }`;
```

with:

```ts
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBrightness;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  gl_FragColor = vec4(min(c.rgb * uBrightness, vec3(1.0)), c.a);
}`;
```

- [ ] **Step 2: Add the uniform**

In the constructor's `uniforms` object (from Task 2's edit, currently):

```ts
      uniforms: { uAtlas: { value: smallTex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
```

add `uBrightness`:

```ts
      uniforms: { uAtlas: { value: smallTex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 }, uBrightness: { value: 1.25 } },
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass (no test touches the shader source or uniforms).

- [ ] **Step 4: Commit**

```bash
git add src/constellation.ts
git commit -m "feat: lift sprite brightness via a clamped uBrightness uniform"
```

---

### Task 8: Minimap dot color + border polish

**Files:**
- Modify: `src/minimap.ts` (full file, 45 lines today)

**Interfaces:**
- Consumes: `pickTintColor` from `src/attractor/palette.ts` (already exists, already used by `piece.ts` for live-attractor tinting — same fix for the same underlying problem).
- Produces: no new exported symbols.

No automated test (canvas 2D rendering — visual, judged live per spec §3.5/§5). `pickTintColor` itself already exists untested in this codebase (out of scope to add coverage for it here — it predates this plan).

- [ ] **Step 1: Implement**

Replace the full contents of `src/minimap.ts`:

```ts
import type * as THREE from 'three';
import type { Artwork } from './data';
import { worldPerPixel } from './controls';
import { pickTintColor } from './attractor/palette';

const SIZE = 140, WORLD = 60; // world units mapped edge-to-edge

export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dotColors: string[];

  constructor(overlay: HTMLElement, private artworks: Artwork[], onJump: (x: number, y: number) => void) {
    this.cv = document.createElement('canvas');
    this.cv.id = 'minimap';
    this.cv.width = this.cv.height = SIZE * 2;
    overlay.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
    // Precomputed once, not in update() (which runs every animation frame): palette[0] is each
    // artwork's near-black background swatch (see pickTintColor's own header comment in
    // attractor/palette.ts), not a usable dot color -- pickTintColor already solves exactly this
    // problem for the live-attractor tint and is reused here for the same reason.
    this.dotColors = artworks.map(a => '#' + pickTintColor(a.palette).getHexString());
    this.cv.addEventListener('click', e => {
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / SIZE - 0.5) * 2 * WORLD;
      const y = -((e.clientY - r.top) / SIZE - 0.5) * 2 * WORLD;
      onJump(x, y);
    });
  }

  update(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
         positionOf: (i: number) => { x: number; y: number }): void {
    const c = this.ctx, S = SIZE * 2;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10,12,18,0.85)';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, S - 1, S - 1);
    const px = (wx: number) => (wx / WORLD / 2 + 0.5) * S;
    const py = (wy: number) => (-wy / WORLD / 2 + 0.5) * S;
    this.artworks.forEach((_, i) => {
      const p = positionOf(i);
      c.fillStyle = this.dotColors[i];
      c.fillRect(px(p.x) - 1.5, py(p.y) - 1.5, 3, 3);
    });
    const wpp = worldPerPixel(camera, canvas.clientHeight);
    const vw = canvas.clientWidth * wpp, vh = canvas.clientHeight * wpp;
    c.strokeStyle = '#cfd3dc';
    c.lineWidth = 2;
    c.strokeRect(px(camera.position.x - vw / 2), py(camera.position.y + vh / 2),
                 (vw / WORLD / 2) * S, (vh / WORLD / 2) * S);
  }
}
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/minimap.ts
git commit -m "feat: minimap dots use pickTintColor instead of the near-black background swatch"
```

---

### Task 9: Full build verification, cold-load size check, and live verification

**Files:** none (verification-only task).

**Interfaces:** consumes everything from Tasks 1-8.

- [ ] **Step 1: Clean up the stale local atlas.png**

`buildAtlas` (Task 1) no longer writes `atlas.png`, but a previously-generated one may still sit in `public/images/` locally — `npm run build` copies everything under `public/` into `dist/` verbatim, so a stale leftover would get copied into `dist/images/atlas.png` and then re-deployed by `scripts/deploy.sh` (which rsyncs `dist/` with `--delete`, but only deletes what's absent from a *fresh* `dist/` — a stale `public/` file isn't absent, it's just wrong). Delete it before regenerating:

```bash
rm -f public/images/atlas.png
```

- [ ] **Step 2: Regenerate real pipeline output**

```bash
npm run pipeline
```

Expected: completes without error; `public/images/atlas-32.webp` and `public/images/atlas-128.webp` now exist; `public/data/atlas.json` has a `files` key.

- [ ] **Step 3: Run the full suite against real data**

```bash
npm test
```

Expected: all tests pass, including `tests/completeness.test.mjs`'s extended atlas test (Task 1) — this one only runs now that real pipeline output exists, and specifically asserts `existsSync('public/images/atlas.png') === false`, catching a forgotten cleanup in Step 1.

- [ ] **Step 4: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no type errors; `dist/` produced.

- [ ] **Step 5: Measure the cold-load transfer size against spec §1's target**

```bash
ls -la dist/assets/app.js dist/assets/index.css dist/images/atlas-32.webp dist/data/artworks.json dist/data/atlas.json dist/data/attractors.json
```

Sum `app.js` + `index.css` + `atlas-32.webp` + the three JSON files (gzip-over-the-wire sizes will be smaller than these raw sizes — Vite already reports gzip size for `app.js`/`index.css` in its own build output from Step 4). Compare against spec §1's target: app code ~146 KB, JSON ~38 KB, atlas ≲150 KB, total ≤ ~500 KB (loosely — the spec's own target range). If `atlas-32.webp` is meaningfully over ~150 KB, that's a real regression to fix before proceeding (lower Task 1's `TILE_SMALL` quality or investigate — do not silently ship an oversized "small" tier).

- [ ] **Step 6: Live verification — start the dev server**

```bash
npm run dev
```

- [ ] **Step 7: Live verification — blur-up and framing (desktop)**

In the browser at `http://localhost:5173`, with the network panel open and cache disabled:
1. Reload. Confirm the constellation appears almost immediately as soft/blurry sprite forms (the 32px tier), then sharpens to full detail within roughly a second (the 128px tier swapping in) — no flicker or pop, no layout shift.
2. Confirm the network panel shows exactly one request each to `atlas-32.webp` and `atlas-128.webp`, and zero requests to `music.apple.com`/Apple CDN image hosts and zero `/images/256/*.jpg` (index thumbnail) requests before you've clicked Index or Music.
3. Confirm the cloud opens centered in the viewport, filling roughly 85% of the screen, with nothing clipped at any edge.
4. Drag to pan, then reload — confirm the cloud is still centered/framed on reload (a fresh boot, not carrying over the drag).
5. Drag to pan again (don't reload this time), then resize the browser window — confirm the view does **not** snap back to the fitted framing (your pan is preserved; `hasUserMoved()` should have latched).

- [ ] **Step 8: Live verification — framing on mobile + rotation**

Using `resize_window` presets or DevTools device emulation:
1. Switch to a mobile portrait preset (e.g. 375×812). Reload. Confirm the cloud is centered and fills ~85% of the width or height (whichever is limiting) — no large dead black bands top/bottom the way the pre-fix screenshot showed.
2. Rotate to landscape (swap width/height). Confirm the framing re-fits to the new aspect (the `resize` event fires on rotation) — again, only if you haven't panned/zoomed since the last reload.
3. Repeat step 1 for a tablet preset.

- [ ] **Step 9: Live verification — lazy Index/Music (network panel)**

1. Reload with the network panel open. Click **Index**. Confirm index-thumbnail (`/images/256/*.jpg`) requests fire now, not before.
2. Close Index, click **Index** again. Confirm no *new* thumbnail requests fire the second time (the view is cached, not rebuilt).
3. Click **Music**. Confirm Apple Music CDN art requests fire now, not before.
4. Close Music, click it again. Confirm no new Apple CDN requests fire the second time.
5. From within Music, click **Index** — confirm Music closes and Index opens (still works, matches the pre-existing cross-view-switch requirement from the music-section work).
6. Deep-link directly to `/music/` (paste the URL, don't click the button first) — confirm Music opens on load (first-hit lazy construction still honors deep links).

- [ ] **Step 10: Live verification — polish**

1. Compare sprite brightness against a screenshot from before this branch (or just judge by eye against the mosaic reference image) — sprites should read as visibly brighter, not washed out or clipped to flat white.
2. Open the minimap (bottom-left) — dots should now read as distinct colors (pinks, golds, greens, etc.) rather than mostly-invisible near-black specks. The camera-viewport rectangle and the 1px map border should both still be visible.

- [ ] **Step 11: Final full-suite + build confirmation**

```bash
npm test
npx tsc --noEmit
```

Expected: all green, no type errors — confirms nothing broken by the pipeline regeneration or live testing session.

- [ ] **Step 12: Commit** (only if Step 1's `rm` or any fix-up during this task produced uncommitted changes — the pipeline output itself under `public/` is untracked/gitignored, so `npm run pipeline` in Steps 1-2 produces no commit-worthy diff by itself)

```bash
git status
# If clean, nothing to commit -- Tasks 1-8's commits already cover every source change.
```

---

## Post-plan: deploy (not part of this plan's task-commit cycle)

Per spec §6, after this branch is reviewed and merged to `main`:
1. CI's code-only deploy runs automatically but is harmless/incomplete on its own (the live site's data won't match the new client until step 2).
2. Run `npm run pipeline` again on `main` (regenerates atlases + `atlas.json` fresh) and then `scripts/deploy.sh` — one atomic push of the whole built `dist/`, so client and data always match on the live site (this mirrors exactly how the shareability work's Task 3 in this repo's own `.superpowers/sdd/progress.md` handled its rollout).
3. Verify live: blur-up sequence, full-res swap, framing on desktop + mobile, no thumbnail/album-art requests until Index/Music opened — the same checks as Task 9 Steps 7-9, against `chaosofzen.dev` instead of localhost.

## Self-Review Notes

**Spec coverage:** §1 (purpose/success criteria) → Tasks 1-9 collectively (size target measured in Task 9 Step 5; framing/lazy-loading criteria verified in Task 9 Steps 7-9). §2 (decisions) → atlas tiers (Task 1-2), framing fit/centering (Task 3, 5), both polish items in scope (Task 7, 8). §3.1 (pipeline) → Task 1. §3.2 (client atlas loading) → Task 2. §3.3 (lazy views) → Task 6. §3.4 (framing) → Tasks 3, 4, 5. §3.5 (polish) → Tasks 7, 8. §4 (error handling) → full-atlas load failure handled in Task 2 Step 4 (`console.warn`, stays on small tier, matching "site fully functional, just soft"); pipeline failure modes unchanged (Task 1 doesn't touch error handling, sharp still fails loudly); old-client/new-data skew addressed by the Post-plan deploy section's single atomic `dist/` push. §5 (testing) → `fitCamera`/bounds/`clampCamera`/`buildAtlas` all TDD'd (Tasks 1, 3, 4); live verification exhaustively checklisted in Task 9. §6 (deploy) → Post-plan section.

**Placeholder scan:** no TBD/TODO, no "add appropriate handling" — every code block is complete and copy-pasteable. Task 9's cold-load size check (Step 5) is a measure-and-compare step rather than a hard automated assertion, since no existing test in this repo enforces a byte budget (consistent with how the shareability plan's favicon-size check was also manual) — this is called out explicitly, not hidden.

**Type consistency:** `Bounds` is defined once in `src/controls.ts` (Task 3) and imported by name (`import type { Bounds } from './controls'`) everywhere else it's used (`constellation.ts`'s `computeCloudBounds` return type, `Controls`'s own `bounds` field). `fitCamera(bounds: Bounds, aspect: number, fovDeg: number, fill = 0.85): { x: number; y: number; z: number }` has the identical signature everywhere it's called (`Controls.fitZ()` in Task 4, `main.ts`'s `applyFraming` in Task 5). `Atlas.files: { small: string; full: string }` (Task 2) matches the exact shape `buildAtlas` writes (Task 1) and the exact shape `Constellation`'s constructor reads (Task 2). `index`/`music`'s nullable types (Task 6) are used consistently via `?.` everywhere they're read after that task (keydown handler, render loop, router).
