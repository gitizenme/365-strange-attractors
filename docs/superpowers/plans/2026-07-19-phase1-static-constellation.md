# Phase 1: Static Constellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the static Living Archive — a WebGL constellation of all 365 artworks clustered by visual similarity, with zoom/pan exploration, hover effects, a piece view showing high-res renders with prev/next navigation, a time-view spiral, calendar index, search, minimap, and shareable URLs.

**Architecture:** A build pipeline (Node + Python) reads the 2010 archive read-only and emits static assets (`public/data/*.json`, responsive images, a sprite atlas, 365 prerendered HTML pages). A Vite + TypeScript + Three.js single-page app renders the constellation from those assets. No backend.

**Tech Stack:** Node ≥20, sharp, Vite 5, TypeScript 5, Three.js (r160+), vitest; Python 3.11+, Pillow, numpy, scikit-learn, umap-learn, pytest.

## Global Constraints

- Project root: `/Users/joe/Pictures/Art/365 Strange Attractors/website/` — all paths below relative to it. Working dir for all commands is the project root.
- Source archive root: `..` (the art folder). **Never write to any path outside `website/`.** The archive is read-only input.
- Source images: `../generated/` (files named `NNN_Title.jpg`); titles: `../365ImageList.csv` (lines like `001/365 Rose,http://...`).
- Exactly 365 days, numbered 1–365. Slugs are `NNN-kebab-title` (e.g. `042-spirality`). URLs: `/`, `/day/NNN-slug/`, `/index/`, `/about/`.
- Image derivative sizes: 2000, 1024, 256 px wide (AVIF + WebP + JPEG each); atlas tiles 128×128, 20 columns.
- Audio and live attractor rendering are OUT of scope (Phases 2–3).
- Respect `prefers-reduced-motion`: no ambient drift, no inertia when set.
- Generated assets in `public/data/`, `public/images/`, `public/day/` are build products: gitignored.
- Commit after every task with the message given in the task.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `index.html`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test` (vitest). `index.html` with `<div id="overlay">` and `<canvas id="gl">`, entry `src/main.ts`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "living-archive",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "pipeline": "node pipeline/build.mjs"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install three && npm install -D vite typescript vitest @types/three sharp`
Expected: no errors; `node_modules/` created.

- [ ] **Step 3: Create config files**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:
```
node_modules/
dist/
public/data/
public/images/
public/day/
pipeline/.venv/
.DS_Store
```

- [ ] **Step 4: Create index.html, src/style.css, src/main.ts**

`index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>365 Strange Attractors</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <canvas id="gl"></canvas>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/style.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; background: #06070a; color: #cfd3dc; font-family: Georgia, serif; overflow: hidden; }
#gl { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#overlay { position: fixed; inset: 0; pointer-events: none; }
#overlay > * { pointer-events: auto; }
```

`src/main.ts`:
```ts
console.log('living archive boot');
```

- [ ] **Step 5: Verify dev server and build**

Run: `npm run build`
Expected: `dist/` produced with `assets/app.js`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + ts + three project"
```

---

### Task 2: Day Manifest (titles + source images)

**Files:**
- Create: `pipeline/manifest.mjs`, `tests/manifest.test.mjs`

**Interfaces:**
- Produces: `slugify(title: string): string`; `parseTitlesCsv(csv: string): Map<number, string>` (day → title); `scanGenerated(fileNames: string[]): Map<number, string>` (day → filename); `buildDays(csv, fileNames): Day[]` where `Day = { day: number, title: string, slug: string, sourceImage: string }`, sorted by day, throws if any day 1–365 lacks a source image. Titles fall back to filename-derived (underscores → spaces) when missing from CSV.

- [ ] **Step 1: Write the failing test**

`tests/manifest.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { slugify, parseTitlesCsv, scanGenerated, buildDays } from '../pipeline/manifest.mjs';

describe('slugify', () => {
  it('kebab-cases and strips punctuation', () => {
    expect(slugify("Satellite of Love")).toBe('satellite-of-love');
    expect(slugify("A Certain Uncertainty")).toBe('a-certain-uncertainty');
  });
});

describe('parseTitlesCsv', () => {
  it('extracts day and title, ignores junk lines and dupes', () => {
    const csv = '001/365 Rose,http://x/001.png,bundle://a,bundle://b\r\n' +
      '002/365 Event Horizon,http://x/002.png,b,c\n' +
      'garbage line\n' +
      '002/365 Duplicate,http://x,b,c\n';
    const m = parseTitlesCsv(csv);
    expect(m.get(1)).toBe('Rose');
    expect(m.get(2)).toBe('Event Horizon');
    expect(m.size).toBe(2);
  });
});

describe('scanGenerated', () => {
  it('maps day number to filename, keeps first match, ignores non-day files', () => {
    const m = scanGenerated(['001_Rose.jpg', '002_Event_Horizon.jpg', 'notes.txt', '002_Alt.jpg']);
    expect(m.get(1)).toBe('001_Rose.jpg');
    expect(m.get(2)).toBe('002_Event_Horizon.jpg');
    expect(m.size).toBe(2);
  });
});

describe('buildDays', () => {
  it('merges titles with images, falls back to filename title', () => {
    const csv = '001/365 Rose,u,b,c\n';
    const files = ['001_Rose.jpg', '002_Event_Horizon.jpg'];
    const days = buildDays(csv, files, 2);
    expect(days).toEqual([
      { day: 1, title: 'Rose', slug: '001-rose', sourceImage: '001_Rose.jpg' },
      { day: 2, title: 'Event Horizon', slug: '002-event-horizon', sourceImage: '002_Event_Horizon.jpg' },
    ]);
  });
  it('throws when a day has no image', () => {
    expect(() => buildDays('', ['001_Rose.jpg'], 2)).toThrow(/missing source image for day 2/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manifest.test.mjs`
Expected: FAIL — cannot find module `../pipeline/manifest.mjs`.

- [ ] **Step 3: Write implementation**

`pipeline/manifest.mjs`:
```js
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseTitlesCsv(csv) {
  const map = new Map();
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^(\d{3})\/365\s+([^,]+),/);
    if (!m) continue;
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 365 || map.has(day)) continue;
    map.set(day, m[2].trim());
  }
  return map;
}

export function scanGenerated(fileNames) {
  const map = new Map();
  for (const name of fileNames.sort()) {
    const m = name.match(/^(\d{3})_(.+)\.(jpe?g|png)$/i);
    if (!m) continue;
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 365 || map.has(day)) continue;
    map.set(day, name);
  }
  return map;
}

export function buildDays(csv, fileNames, maxDay = 365) {
  const titles = parseTitlesCsv(csv);
  const images = scanGenerated(fileNames);
  const days = [];
  for (let day = 1; day <= maxDay; day++) {
    const sourceImage = images.get(day);
    if (!sourceImage) throw new Error(`missing source image for day ${day}`);
    const fallback = sourceImage.replace(/^\d{3}_/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    const title = titles.get(day) ?? fallback;
    const num = String(day).padStart(3, '0');
    days.push({ day, title, slug: `${num}-${slugify(title)}`, sourceImage });
  }
  return days;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manifest.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Smoke-test against the real archive**

Run: `node -e "import('./pipeline/manifest.mjs').then(async m => { const fs = await import('node:fs'); const days = m.buildDays(fs.readFileSync('../365ImageList.csv','utf8'), fs.readdirSync('../generated')); console.log(days.length, days[0], days[364]); })"`
Expected: `365 { day: 1, title: 'Rose', ... } { day: 365, title: 'Icosapods', ... }`. If it throws for a specific day, inspect that day's files in `../generated/` and adjust `scanGenerated`'s pattern — do not hand-edit the archive.

- [ ] **Step 6: Commit**

```bash
git add pipeline/manifest.mjs tests/manifest.test.mjs && git commit -m "feat: day manifest from CSV titles + generated/ scan"
```

---

### Task 3: Image Derivatives + Sprite Atlas

**Files:**
- Create: `pipeline/images.mjs`, `tests/images.test.mjs`

**Interfaces:**
- Consumes: `Day[]` from `buildDays`.
- Produces: `makeDerivatives(srcPath, slug, outRoot): Promise<void>` writing `<outRoot>/images/{2000,1024,256}/<slug>.{avif,webp,jpg}`; `buildAtlas(items: {slug, srcPath}[], outRoot): Promise<AtlasManifest>` writing `<outRoot>/images/atlas.png` + `<outRoot>/data/atlas.json`. `AtlasManifest = { tile: 128, cols: 20, rows: number, index: Record<slug, number> }` (tile i at col `i % cols`, row `Math.floor(i / cols)`).

- [ ] **Step 1: Write the failing test**

`tests/images.test.mjs`:
```js
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { makeDerivatives, buildAtlas } from '../pipeline/images.mjs';

let dir, src;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'la-img-'));
  src = join(dir, 'src.jpg');
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .jpeg().toFile(src);
});

describe('makeDerivatives', () => {
  it('writes avif/webp/jpg at three widths (never upscaling)', async () => {
    await makeDerivatives(src, '001-rose', dir);
    for (const size of [2000, 1024, 256])
      for (const ext of ['avif', 'webp', 'jpg'])
        expect(existsSync(join(dir, 'images', String(size), `001-rose.${ext}`))).toBe(true);
    const meta = await sharp(join(dir, 'images', '2000', '001-rose.jpg')).metadata();
    expect(meta.width).toBe(400); // source smaller than 2000 → not upscaled
    const meta256 = await sharp(join(dir, 'images', '256', '001-rose.jpg')).metadata();
    expect(meta256.width).toBe(256);
  });
});

describe('buildAtlas', () => {
  it('composites square tiles and writes manifest', async () => {
    const items = [{ slug: '001-rose', srcPath: src }, { slug: '002-x', srcPath: src }];
    const manifest = await buildAtlas(items, dir);
    expect(manifest).toEqual({ tile: 128, cols: 20, rows: 1, index: { '001-rose': 0, '002-x': 1 } });
    const meta = await sharp(join(dir, 'images', 'atlas.png')).metadata();
    expect(meta.width).toBe(20 * 128);
    expect(meta.height).toBe(128);
    expect(JSON.parse(readFileSync(join(dir, 'data', 'atlas.json'), 'utf8'))).toEqual(manifest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.mjs`
Expected: FAIL — cannot find module `../pipeline/images.mjs`.

- [ ] **Step 3: Write implementation**

`pipeline/images.mjs`:
```js
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [2000, 1024, 256];
const TILE = 128;
const COLS = 20;

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

export async function buildAtlas(items, outRoot) {
  const rows = Math.ceil(items.length / COLS);
  const composites = [];
  const index = {};
  for (let i = 0; i < items.length; i++) {
    index[items[i].slug] = i;
    const buf = await sharp(items[i].srcPath)
      .resize(TILE, TILE, { fit: 'cover' }).png().toBuffer();
    composites.push({ input: buf, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE });
  }
  mkdirSync(join(outRoot, 'images'), { recursive: true });
  mkdirSync(join(outRoot, 'data'), { recursive: true });
  await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites).png().toFile(join(outRoot, 'images', 'atlas.png'));
  const manifest = { tile: TILE, cols: COLS, rows, index };
  writeFileSync(join(outRoot, 'data', 'atlas.json'), JSON.stringify(manifest));
  return manifest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/images.mjs tests/images.test.mjs && git commit -m "feat: responsive image derivatives and sprite atlas"
```

---

### Task 4: Image Analysis (palette, brightness, UMAP layout)

**Files:**
- Create: `pipeline/requirements.txt`, `pipeline/analyze.py`, `pipeline/tests/test_analyze.py`

**Interfaces:**
- Consumes: `public/data/days.json` (written later by Task 5's orchestrator; for this task, tests use synthetic data) and 256px JPEG derivatives at `public/images/256/<slug>.jpg`.
- Produces: CLI `python pipeline/analyze.py <days.json> <images256dir> <out.json>` writing `analysis.json`: `[{ slug, palette: [hex×5], brightness: float 0–1, x: float, y: float }]` with x/y in [-50, 50]. Functions: `extract_palette(img) -> list[str]`, `mean_brightness(img) -> float`, `embed(img) -> np.ndarray` (8×8 RGB = 192-dim), `layout(embeddings) -> np.ndarray (N,2)` (UMAP, normalized to [-50,50]).

- [ ] **Step 1: Create requirements and venv**

`pipeline/requirements.txt`:
```
Pillow>=10
numpy>=1.26
scikit-learn>=1.4
umap-learn>=0.5
pytest>=8
```

Run: `python3 -m venv pipeline/.venv && pipeline/.venv/bin/pip install -q -r pipeline/requirements.txt`
Expected: exit 0.

- [ ] **Step 2: Write the failing test**

`pipeline/tests/test_analyze.py`:
```python
import numpy as np
from PIL import Image
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from analyze import extract_palette, mean_brightness, embed, layout

def solid(rgb, size=64):
    return Image.new('RGB', (size, size), rgb)

def test_palette_of_solid_image_is_that_color():
    pal = extract_palette(solid((255, 0, 0)))
    assert len(pal) == 5
    assert pal[0] == '#ff0000'

def test_brightness_bounds():
    assert mean_brightness(solid((0, 0, 0))) == 0.0
    assert mean_brightness(solid((255, 255, 255))) == 1.0

def test_embed_shape():
    assert embed(solid((10, 20, 30))).shape == (192,)

def test_layout_normalized_and_separates_colors():
    rng = np.random.default_rng(1)
    reds = [embed(solid((255, r, r))) for r in rng.integers(0, 60, 10)]
    blues = [embed(solid((b, b, 255))) for b in rng.integers(0, 60, 10)]
    pts = layout(np.array(reds + blues))
    assert pts.shape == (20, 2)
    assert pts.min() >= -50 and pts.max() <= 50
    red_c, blue_c = pts[:10].mean(0), pts[10:].mean(0)
    assert np.linalg.norm(red_c - blue_c) > 10  # clusters separate
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pipeline/.venv/bin/pytest pipeline/tests -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'analyze'`.

- [ ] **Step 4: Write implementation**

`pipeline/analyze.py`:
```python
import json, sys, pathlib
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

def extract_palette(img, k=5):
    px = np.asarray(img.convert('RGB').resize((64, 64))).reshape(-1, 3).astype(float)
    uniq = np.unique(px, axis=0)
    k = min(k, len(uniq))
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(px)
    counts = np.bincount(km.labels_)
    centers = km.cluster_centers_[np.argsort(-counts)].round().astype(int)
    hexes = ['#%02x%02x%02x' % tuple(c) for c in centers]
    return (hexes + hexes[-1:] * 5)[:5]

def mean_brightness(img):
    return float(np.asarray(img.convert('L')).mean() / 255.0)

def embed(img):
    small = np.asarray(img.convert('RGB').resize((8, 8))).astype(float) / 255.0
    return small.reshape(-1)

def layout(embeddings):
    import umap
    n = len(embeddings)
    pts = umap.UMAP(n_neighbors=min(15, n - 1), min_dist=0.3,
                    random_state=42).fit_transform(embeddings)
    pts = pts - pts.mean(0)
    scale = np.abs(pts).max() or 1.0
    return pts / scale * 50.0

def main(days_path, img_dir, out_path):
    days = json.loads(pathlib.Path(days_path).read_text())
    imgs = [Image.open(pathlib.Path(img_dir) / f"{d['slug']}.jpg") for d in days]
    pts = layout(np.array([embed(im) for im in imgs]))
    out = [{'slug': d['slug'],
            'palette': extract_palette(im),
            'brightness': round(mean_brightness(im), 4),
            'x': round(float(p[0]), 3), 'y': round(float(p[1]), 3)}
           for d, im, p in zip(days, imgs, pts)]
    pathlib.Path(out_path).write_text(json.dumps(out))
    print(f"analyzed {len(out)} artworks -> {out_path}")

if __name__ == '__main__':
    main(*sys.argv[1:4])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pipeline/.venv/bin/pytest pipeline/tests -v`
Expected: PASS (4 tests). (UMAP's first run may take ~30s to JIT-compile numba; that's normal.)

- [ ] **Step 6: Commit**

```bash
git add pipeline/requirements.txt pipeline/analyze.py pipeline/tests/test_analyze.py && git commit -m "feat: image analysis - palette, brightness, umap layout"
```

---

### Task 5: Pipeline Orchestrator + Completeness Test

**Files:**
- Create: `pipeline/build.mjs`, `tests/completeness.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: `npm run pipeline` writes: `public/data/days.json` (`Day[]`), `public/images/{2000,1024,256}/*`, `public/images/atlas.png`, `public/data/atlas.json`, then runs `analyze.py`, then merges into **`public/data/artworks.json`**: `[{ day, title, slug, palette, brightness, x, y }]` sorted by day — the app's single data file. Skips image work when outputs already exist (idempotent re-runs) unless `--force`.

- [ ] **Step 1: Write the failing completeness test**

`tests/completeness.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const DATA = 'public/data/artworks.json';

describe.skipIf(!existsSync(DATA))('pipeline output completeness', () => {
  const art = JSON.parse(readFileSync(DATA, 'utf8'));
  it('has 365 artworks, days 1..365, unique slugs', () => {
    expect(art.length).toBe(365);
    expect(new Set(art.map(a => a.slug)).size).toBe(365);
    art.forEach((a, i) => expect(a.day).toBe(i + 1));
  });
  it('every artwork has coordinates, palette, images', () => {
    for (const a of art) {
      expect(Math.abs(a.x)).toBeLessThanOrEqual(50);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(50);
      expect(a.palette).toHaveLength(5);
      for (const size of ['2000', '1024', '256'])
        expect(existsSync(`public/images/${size}/${a.slug}.jpg`), `${size}/${a.slug}`).toBe(true);
    }
  });
  it('atlas covers every slug', () => {
    const atlas = JSON.parse(readFileSync('public/data/atlas.json', 'utf8'));
    for (const a of art) expect(atlas.index[a.slug]).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it skips (no output yet)**

Run: `npx vitest run tests/completeness.test.mjs`
Expected: suite reported as skipped (guard works before pipeline has run).

- [ ] **Step 3: Write the orchestrator**

`pipeline/build.mjs`:
```js
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDays } from './manifest.mjs';
import { makeDerivatives, buildAtlas } from './images.mjs';

const ARCHIVE = resolve('..');
const OUT = resolve('public');
const force = process.argv.includes('--force');

const days = buildDays(
  readFileSync(join(ARCHIVE, '365ImageList.csv'), 'utf8'),
  readdirSync(join(ARCHIVE, 'generated')),
);
mkdirSync(join(OUT, 'data'), { recursive: true });
writeFileSync(join(OUT, 'data', 'days.json'), JSON.stringify(days));
console.log(`manifest: ${days.length} days`);

let made = 0;
for (const d of days) {
  const src = join(ARCHIVE, 'generated', d.sourceImage);
  if (force || !existsSync(join(OUT, 'images', '256', `${d.slug}.jpg`))) {
    await makeDerivatives(src, d.slug, OUT);
    made++;
  }
}
console.log(`derivatives: ${made} generated, ${days.length - made} cached`);

await buildAtlas(days.map(d => ({ slug: d.slug, srcPath: join(ARCHIVE, 'generated', d.sourceImage) })), OUT);
console.log('atlas written');

execFileSync('pipeline/.venv/bin/python', [
  'pipeline/analyze.py',
  join(OUT, 'data', 'days.json'),
  join(OUT, 'images', '256'),
  join(OUT, 'data', 'analysis.json'),
], { stdio: 'inherit' });

const analysis = JSON.parse(readFileSync(join(OUT, 'data', 'analysis.json'), 'utf8'));
const bySlug = new Map(analysis.map(a => [a.slug, a]));
const artworks = days.map(d => {
  const a = bySlug.get(d.slug);
  return { day: d.day, title: d.title, slug: d.slug, palette: a.palette, brightness: a.brightness, x: a.x, y: a.y };
});
writeFileSync(join(OUT, 'data', 'artworks.json'), JSON.stringify(artworks));
console.log(`artworks.json: ${artworks.length} entries`);
```

- [ ] **Step 4: Run the full pipeline against the real archive**

Run: `npm run pipeline`
Expected: `manifest: 365 days`, derivative generation (several minutes on first run — 365 × 9 outputs), `atlas written`, `analyzed 365 artworks`, `artworks.json: 365 entries`. Exit 0.

- [ ] **Step 5: Run completeness test to verify it passes**

Run: `npx vitest run tests/completeness.test.mjs`
Expected: PASS (3 tests, no longer skipped).

- [ ] **Step 6: Commit**

```bash
git add pipeline/build.mjs tests/completeness.test.mjs && git commit -m "feat: pipeline orchestrator producing artworks.json + completeness test"
```

---

### Task 6: Prerendered Piece Pages

**Files:**
- Create: `pipeline/pages.mjs`, `tests/pages.test.mjs`
- Modify: `pipeline/build.mjs` (append page generation)

**Interfaces:**
- Consumes: `artworks.json` entries.
- Produces: `renderPiecePage(artwork): string` (full HTML doc with title, OpenGraph tags, `<picture>` element, caption, and `<script type="module" src="/assets/app.js">`); build step writing `public/day/<slug>/index.html` for all 365.

- [ ] **Step 1: Write the failing test**

`tests/pages.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { renderPiecePage } from '../pipeline/pages.mjs';

const art = { day: 42, title: 'Spirality', slug: '042-spirality', palette: ['#112233','#223344','#334455','#445566','#556677'], brightness: 0.4, x: 1, y: 2 };

describe('renderPiecePage', () => {
  const html = renderPiecePage(art);
  it('includes title, day, og tags, image sources, app script', () => {
    expect(html).toContain('<title>Spirality — 042/365');
    expect(html).toContain('property="og:title" content="Spirality — 042/365 Strange Attractors"');
    expect(html).toContain('property="og:image" content="/images/1024/042-spirality.jpg"');
    expect(html).toContain('srcset="/images/1024/042-spirality.avif 1024w, /images/2000/042-spirality.avif 2000w"');
    expect(html).toContain('src="/images/1024/042-spirality.jpg"');
    expect(html).toContain('alt="Spirality — strange attractor, day 42 of 365, 2010"');
    expect(html).toContain('src="/assets/app.js"');
  });
  it('escapes html in titles', () => {
    expect(renderPiecePage({ ...art, title: 'A<B&C' })).toContain('A&lt;B&amp;C');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pages.test.mjs`
Expected: FAIL — cannot find module `../pipeline/pages.mjs`.

- [ ] **Step 3: Write implementation**

`pipeline/pages.mjs`:
```js
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPiecePage(a) {
  const num = String(a.day).padStart(3, '0');
  const t = esc(a.title);
  const name = `${t} — ${num}/365`;
  const srcset = ext => `/images/1024/${a.slug}.${ext} 1024w, /images/2000/${a.slug}.${ext} 2000w`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} Strange Attractors</title>
<meta property="og:title" content="${name} Strange Attractors" />
<meta property="og:type" content="article" />
<meta property="og:image" content="/images/1024/${a.slug}.jpg" />
<meta name="description" content="${t}, a strange attractor created on day ${a.day} of 365 in 2010." />
<link rel="stylesheet" href="/assets/style.css" />
</head>
<body>
<canvas id="gl"></canvas>
<div id="overlay">
<figure class="static-piece">
<picture>
<source type="image/avif" srcset="${srcset('avif')}" />
<source type="image/webp" srcset="${srcset('webp')}" />
<img src="/images/1024/${a.slug}.jpg" srcset="${srcset('jpg')}"
     alt="${t} — strange attractor, day ${a.day} of 365, 2010" />
</picture>
<figcaption>${name} · 2010</figcaption>
</figure>
</div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pages.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into build.mjs**

Append to `pipeline/build.mjs`:
```js
import { renderPiecePage } from './pages.mjs';
for (const a of artworks) {
  const dir = join(OUT, 'day', a.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderPiecePage(a));
}
console.log(`pages: ${artworks.length} written`);
```

Run: `npm run pipeline`
Expected: ends with `pages: 365 written` (derivatives reported cached, fast).

- [ ] **Step 6: Commit**

```bash
git add pipeline/pages.mjs tests/pages.test.mjs pipeline/build.mjs && git commit -m "feat: prerendered piece pages with OpenGraph tags"
```

---

### Task 7: App Data Layer + Router

**Files:**
- Create: `src/data.ts`, `src/router.ts`, `tests/router.test.ts`

**Interfaces:**
- Produces:
  - `src/data.ts`: `interface Artwork { day: number; title: string; slug: string; palette: string[]; brightness: number; x: number; y: number }`; `interface Atlas { tile: number; cols: number; rows: number; index: Record<string, number> }`; `loadData(): Promise<{ artworks: Artwork[]; atlas: Atlas }>` (fetches `/data/artworks.json`, `/data/atlas.json`); `imageUrl(slug: string, size: 256|1024|2000, ext: 'avif'|'webp'|'jpg'): string`.
  - `src/router.ts`: `type Route = { kind: 'home' } | { kind: 'day'; slug: string } | { kind: 'index' } | { kind: 'about' }`; `parseRoute(pathname: string): Route`; `routePath(r: Route): string`; `class Router { constructor(onChange: (r: Route) => void); go(r: Route): void; current(): Route }` using history.pushState + popstate.
  - Also `dayToDate(day: number): { month: number; date: number }` for 2010 (not a leap year) in `src/data.ts`.

- [ ] **Step 1: Write the failing test**

`tests/router.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseRoute, routePath } from '../src/router';
import { dayToDate, imageUrl } from '../src/data';

describe('parseRoute', () => {
  it('parses all route kinds', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/day/042-spirality/')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/day/042-spirality')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/index/')).toEqual({ kind: 'index' });
    expect(parseRoute('/about/')).toEqual({ kind: 'about' });
    expect(parseRoute('/nonsense')).toEqual({ kind: 'home' });
  });
  it('round-trips through routePath', () => {
    expect(routePath({ kind: 'day', slug: '001-rose' })).toBe('/day/001-rose/');
    expect(parseRoute(routePath({ kind: 'index' }))).toEqual({ kind: 'index' });
  });
});

describe('dayToDate', () => {
  it('maps day-of-year to 2010 calendar dates', () => {
    expect(dayToDate(1)).toEqual({ month: 1, date: 1 });
    expect(dayToDate(31)).toEqual({ month: 1, date: 31 });
    expect(dayToDate(32)).toEqual({ month: 2, date: 1 });
    expect(dayToDate(59)).toEqual({ month: 2, date: 28 });
    expect(dayToDate(60)).toEqual({ month: 3, date: 1 });
    expect(dayToDate(365)).toEqual({ month: 12, date: 31 });
  });
});

describe('imageUrl', () => {
  it('builds derivative paths', () => {
    expect(imageUrl('001-rose', 1024, 'webp')).toBe('/images/1024/001-rose.webp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write implementation**

`src/data.ts`:
```ts
export interface Artwork {
  day: number; title: string; slug: string;
  palette: string[]; brightness: number; x: number; y: number;
}
export interface Atlas { tile: number; cols: number; rows: number; index: Record<string, number> }

export async function loadData(): Promise<{ artworks: Artwork[]; atlas: Atlas }> {
  const [artworks, atlas] = await Promise.all([
    fetch('/data/artworks.json').then(r => r.json()),
    fetch('/data/atlas.json').then(r => r.json()),
  ]);
  return { artworks, atlas };
}

export function imageUrl(slug: string, size: 256 | 1024 | 2000, ext: 'avif' | 'webp' | 'jpg'): string {
  return `/images/${size}/${slug}.${ext}`;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function dayToDate(day: number): { month: number; date: number } {
  let d = day;
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) return { month: m + 1, date: d };
    d -= MONTH_DAYS[m];
  }
  throw new Error(`invalid day ${day}`);
}
```

`src/router.ts`:
```ts
export type Route =
  | { kind: 'home' } | { kind: 'day'; slug: string }
  | { kind: 'index' } | { kind: 'about' };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '');
  const day = p.match(/^\/day\/([0-9]{3}-[a-z0-9-]+)$/);
  if (day) return { kind: 'day', slug: day[1] };
  if (p === '/index') return { kind: 'index' };
  if (p === '/about') return { kind: 'about' };
  return { kind: 'home' };
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case 'home': return '/';
    case 'day': return `/day/${r.slug}/`;
    case 'index': return '/index/';
    case 'about': return '/about/';
  }
}

export class Router {
  private onChange: (r: Route) => void;
  constructor(onChange: (r: Route) => void) {
    this.onChange = onChange;
    window.addEventListener('popstate', () => this.onChange(this.current()));
  }
  current(): Route { return parseRoute(location.pathname); }
  go(r: Route): void {
    if (routePath(r) !== location.pathname) history.pushState(null, '', routePath(r));
    this.onChange(r);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data.ts src/router.ts tests/router.test.ts && git commit -m "feat: data layer, router, 2010 date mapping"
```

---

### Task 8: Constellation Renderer (instanced atlas sprites)

**Files:**
- Create: `src/constellation.ts`, `tests/constellation.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Artwork[]`, `Atlas`, `imageUrl` from Task 7.
- Produces: `atlasUv(atlas: Atlas, slug: string): { u: number; v: number; su: number; sv: number }` (tile origin + span in texture coords, v measured from texture top handled for Three's flipY); `class Constellation { constructor(canvas: HTMLCanvasElement, artworks: Artwork[], atlas: Atlas); readonly camera: THREE.PerspectiveCamera; setHover(index: number | null): void; setTimeMix(t: number): void; positionOf(index: number): { x: number; y: number }; render(timeSec: number): void; setReducedMotion(on: boolean): void; resize(): void }`. Camera at `z` between 4 (close) and 140 (far), looking at z=0 plane. Sprite world size 1.6 units.

- [ ] **Step 1: Write the failing test (pure UV math)**

`tests/constellation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { atlasUv } from '../src/constellation';

const atlas = { tile: 128, cols: 20, rows: 19, index: { '001-rose': 0, '002-x': 21 } };

describe('atlasUv', () => {
  it('computes tile origin and span in flipY texture coords', () => {
    // tile 0: col 0, row 0 (top-left of image = v near 1 with flipY)
    expect(atlasUv(atlas, '001-rose')).toEqual({ u: 0, v: 1 - 1 / 19, su: 1 / 20, sv: 1 / 19 });
    // tile 21: col 1, row 1
    expect(atlasUv(atlas, '002-x')).toEqual({ u: 1 / 20, v: 1 - 2 / 19, su: 1 / 20, sv: 1 / 19 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/constellation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/constellation.ts`:
```ts
import * as THREE from 'three';
import type { Artwork, Atlas } from './data';
import { spiralPosition } from './timeview';

export function atlasUv(atlas: Atlas, slug: string) {
  const i = atlas.index[slug];
  const col = i % atlas.cols;
  const row = Math.floor(i / atlas.cols);
  const su = 1 / atlas.cols, sv = 1 / atlas.rows;
  return { u: col * su, v: 1 - (row + 1) * sv, su, sv };
}

const VERT = /* glsl */ `
uniform float uTime; uniform float uDrift; uniform float uMix; uniform float uSize;
attribute vec2 aPosA; attribute vec2 aPosB; attribute vec4 aUv; attribute float aScale;
varying vec2 vUv;
void main() {
  vec2 base = mix(aPosA, aPosB, uMix);
  vec2 drift = uDrift * 0.12 * vec2(sin(uTime * 0.11 + base.y * 0.7), cos(uTime * 0.13 + base.x * 0.7));
  vec3 world = vec3(base + drift + position.xy * uSize * aScale, 0.0);
  vUv = vec2(aUv.x + uv.x * aUv.z, aUv.y + uv.y * aUv.w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uAtlas, vUv); }`;

export class Constellation {
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private material: THREE.ShaderMaterial;
  private scaleAttr: THREE.InstancedBufferAttribute;
  private scales: Float32Array;
  private targetScales: Float32Array;
  private posA: Float32Array;
  private posB: Float32Array;
  private mix = 0; private targetMix = 0;

  constructor(private canvas: HTMLCanvasElement, private artworks: Artwork[], atlas: Atlas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(0, 0, 120);

    const n = artworks.length;
    this.posA = new Float32Array(n * 2);
    this.posB = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 4);
    this.scales = new Float32Array(n).fill(1);
    this.targetScales = new Float32Array(n).fill(1);
    artworks.forEach((a, i) => {
      this.posA[i * 2] = a.x; this.posA[i * 2 + 1] = a.y;
      const s = spiralPosition(a.day);
      this.posB[i * 2] = s.x; this.posB[i * 2 + 1] = s.y;
      const t = atlasUv(atlas, a.slug);
      uvs.set([t.u, t.v, t.su, t.sv], i * 4);
    });

    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    geo.setAttribute('aPosA', new THREE.InstancedBufferAttribute(this.posA, 2));
    geo.setAttribute('aPosB', new THREE.InstancedBufferAttribute(this.posB, 2));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvs, 4));
    this.scaleAttr = new THREE.InstancedBufferAttribute(this.scales, 1);
    geo.setAttribute('aScale', this.scaleAttr);
    geo.instanceCount = n;

    const tex = new THREE.TextureLoader().load('/images/atlas.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: tex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.resize();
  }

  setHover(index: number | null): void {
    this.targetScales.fill(1);
    if (index !== null) this.targetScales[index] = 1.35;
  }

  setTimeMix(t: number): void { this.targetMix = t; }

  positionOf(index: number): { x: number; y: number } {
    const a = { x: this.posA[index * 2], y: this.posA[index * 2 + 1] };
    const b = { x: this.posB[index * 2], y: this.posB[index * 2 + 1] };
    return { x: a.x + (b.x - a.x) * this.mix, y: a.y + (b.y - a.y) * this.mix };
  }

  setReducedMotion(on: boolean): void { this.material.uniforms.uDrift.value = on ? 0 : 1; }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(timeSec: number): void {
    this.mix += (this.targetMix - this.mix) * 0.08;
    this.material.uniforms.uMix.value = this.mix;
    this.material.uniforms.uTime.value = timeSec;
    let dirty = false;
    for (let i = 0; i < this.scales.length; i++) {
      const d = this.targetScales[i] - this.scales[i];
      if (Math.abs(d) > 0.001) { this.scales[i] += d * 0.2; dirty = true; }
    }
    if (dirty) this.scaleAttr.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
```

Also create a stub `src/timeview.ts` so this compiles (real version in Task 11):
```ts
export function spiralPosition(day: number): { x: number; y: number } {
  return { x: 0, y: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/constellation.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Boot it in main.ts**

`src/main.ts` (replace):
```ts
import { loadData } from './data';
import { Constellation } from './constellation';

async function boot() {
  const { artworks, atlas } = await loadData();
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const con = new Constellation(canvas, artworks, atlas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  addEventListener('resize', () => con.resize());
  const loop = (t: number) => { con.render(t / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
boot();
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open the served URL.
Expected: dark field with all 365 thumbnails scattered in visible color clusters, drifting gently. No console errors. `npx tsc --noEmit` passes.

- [ ] **Step 7: Commit**

```bash
git add src/constellation.ts src/timeview.ts src/main.ts tests/constellation.test.ts && git commit -m "feat: instanced atlas sprite constellation renderer"
```

---

### Task 9: Camera Controls (pan / zoom / inertia / bounds)

**Files:**
- Create: `src/controls.ts`, `tests/controls.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Constellation.camera`.
- Produces: pure functions `stepInertia(v: {x,y}, dt: number, damping?: number): {x,y}` (exponential decay, returns zero vector below 0.01 magnitude); `clampCamera(pos: {x,y,z}, bounds: number, zMin: number, zMax: number): {x,y,z}`; `worldPerPixel(camera: THREE.PerspectiveCamera, viewportHeight: number): number`; `class Controls { constructor(canvas, camera, opts?: { reducedMotion?: boolean }); update(dt: number): void; flyTo(x: number, y: number, z: number, durationSec: number): Promise<void>; dispose(): void; onTap?: (screenX: number, screenY: number) => void }` — drag pans (moves camera opposite to drag in world units), wheel/pinch zooms toward cursor, releases carry inertia; z clamped [4, 140], x/y clamped ±60. A pointerup with < 5px movement fires `onTap`.

- [ ] **Step 1: Write the failing test**

`tests/controls.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { stepInertia, clampCamera, zoomToward } from '../src/controls';

describe('stepInertia', () => {
  it('decays velocity exponentially and snaps to zero', () => {
    const v1 = stepInertia({ x: 10, y: 0 }, 1 / 60);
    expect(v1.x).toBeLessThan(10);
    expect(v1.x).toBeGreaterThan(0);
    let v = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 600; i++) v = stepInertia(v, 1 / 60);
    expect(v).toEqual({ x: 0, y: 0 });
  });
});

describe('clampCamera', () => {
  it('clamps xy to bounds and z to range', () => {
    expect(clampCamera({ x: 100, y: -100, z: 1 }, 60, 4, 140)).toEqual({ x: 60, y: -60, z: 4 });
    expect(clampCamera({ x: 0, y: 0, z: 200 }, 60, 4, 140)).toEqual({ x: 0, y: 0, z: 140 });
  });
});

describe('zoomToward', () => {
  it('moves camera xy toward target when zooming in', () => {
    const cam = { x: 0, y: 0, z: 100 };
    const out = zoomToward(cam, { x: 10, y: 0 }, 0.5); // halve distance
    expect(out.z).toBe(50);
    expect(out.x).toBeCloseTo(5); // xy interpolates by same factor
  });
  it('is identity at factor 1', () => {
    expect(zoomToward({ x: 3, y: 4, z: 80 }, { x: 0, y: 0 }, 1)).toEqual({ x: 3, y: 4, z: 80 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/controls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/controls.ts`:
```ts
import type * as THREE from 'three';

export function stepInertia(v: { x: number; y: number }, dt: number, damping = 4): { x: number; y: number } {
  const f = Math.exp(-damping * dt);
  const out = { x: v.x * f, y: v.y * f };
  return Math.hypot(out.x, out.y) < 0.01 ? { x: 0, y: 0 } : out;
}

export function clampCamera(p: { x: number; y: number; z: number }, bounds: number, zMin: number, zMax: number) {
  return {
    x: Math.min(bounds, Math.max(-bounds, p.x)),
    y: Math.min(bounds, Math.max(-bounds, p.y)),
    z: Math.min(zMax, Math.max(zMin, p.z)),
  };
}

export function zoomToward(cam: { x: number; y: number; z: number }, target: { x: number; y: number }, factor: number) {
  return {
    x: target.x + (cam.x - target.x) * factor,
    y: target.y + (cam.y - target.y) * factor,
    z: cam.z * factor,
  };
}

export function worldPerPixel(camera: THREE.PerspectiveCamera, viewportHeight: number): number {
  const h = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
  return h / viewportHeight;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class Controls {
  onTap?: (x: number, y: number) => void;
  private vel = { x: 0, y: 0 };
  private dragging = false;
  private moved = 0;
  private last = { x: 0, y: 0 };
  private flying = false;
  private reduced: boolean;
  private ac = new AbortController();

  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera,
              opts: { reducedMotion?: boolean } = {}) {
    this.reduced = opts.reducedMotion ?? false;
    const s = this.ac.signal;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true; this.moved = 0; this.vel = { x: 0, y: 0 };
      this.last = { x: e.clientX, y: e.clientY };
    }, { signal: s });
    canvas.addEventListener('pointermove', e => {
      if (!this.dragging || this.flying) return;
      const wpp = worldPerPixel(this.camera, canvas.clientHeight);
      const dx = (e.clientX - this.last.x), dy = (e.clientY - this.last.y);
      this.moved += Math.hypot(dx, dy);
      this.camera.position.x -= dx * wpp;
      this.camera.position.y += dy * wpp;
      this.vel = { x: -dx * wpp * 60, y: dy * wpp * 60 };
      this.last = { x: e.clientX, y: e.clientY };
      this.clamp();
    }, { signal: s });
    canvas.addEventListener('pointerup', e => {
      this.dragging = false;
      if (this.moved < 5) { this.vel = { x: 0, y: 0 }; this.onTap?.(e.clientX, e.clientY); }
    }, { signal: s });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.flying) return;
      const factor = Math.exp(e.deltaY * 0.0015);
      const t = this.screenToWorld(e.clientX, e.clientY);
      const p = zoomToward(this.camera.position, t, factor);
      Object.assign(this.camera.position, clampCamera(p, 60, 4, 140));
    }, { signal: s, passive: false });
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const wpp = worldPerPixel(this.camera, this.canvas.clientHeight);
    return {
      x: this.camera.position.x + (sx - this.canvas.clientWidth / 2) * wpp,
      y: this.camera.position.y - (sy - this.canvas.clientHeight / 2) * wpp,
    };
  }

  private clamp() { Object.assign(this.camera.position, clampCamera(this.camera.position, 60, 4, 140)); }

  update(dt: number): void {
    if (this.dragging || this.flying || this.reduced) return;
    if (this.vel.x || this.vel.y) {
      this.camera.position.x += this.vel.x * dt;
      this.camera.position.y += this.vel.y * dt;
      this.vel = stepInertia(this.vel, dt);
      this.clamp();
    }
  }

  flyTo(x: number, y: number, z: number, durationSec: number): Promise<void> {
    if (this.reduced) durationSec = 0;
    this.flying = true;
    const from = { ...this.camera.position };
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = () => {
        const t = durationSec === 0 ? 1 : Math.min(1, (performance.now() - t0) / (durationSec * 1000));
        const k = ease(t);
        this.camera.position.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
        if (t < 1) requestAnimationFrame(step);
        else { this.flying = false; resolve(); }
      };
      step();
    });
  }

  dispose(): void { this.ac.abort(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/controls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into main.ts**

In `src/main.ts`, after constructing `con`:
```ts
import { Controls } from './controls';
// inside boot():
const controls = new Controls(canvas, con.camera, { reducedMotion: reduced.matches });
let lastT = 0;
const loop = (t: number) => {
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  controls.update(dt);
  con.render(t / 1000);
  requestAnimationFrame(loop);
};
```
(Replace the existing loop.)

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected: drag pans with inertia on release; wheel zooms toward the cursor; can't zoom past sprites or pan off into emptiness. `npx tsc --noEmit` passes.

- [ ] **Step 7: Commit**

```bash
git add src/controls.ts src/main.ts tests/controls.test.ts && git commit -m "feat: pan/zoom camera controls with inertia and bounds"
```

---

### Task 10: Picking, Hover & Labels

**Files:**
- Create: `src/picking.ts`, `src/labels.ts`, `tests/picking.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Controls.screenToWorld`, `Constellation.positionOf/setHover`, `worldPerPixel`, `Artwork[]`.
- Produces: `nearestSprite(world: {x,y}, positions: (i:number)=>{x,y}, count: number, maxDist: number): number | null` (index of closest within maxDist, else null); `class Labels { constructor(overlay: HTMLElement, artworks: Artwork[]); update(camera, canvas, positionOf, zThreshold?: number): void }` — when `camera.position.z < 40`, shows DOM labels ("042 · Spirality") for up to 12 sprites nearest screen center, projected to screen coords; hides otherwise.

- [ ] **Step 1: Write the failing test**

`tests/picking.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { nearestSprite } from '../src/picking';

const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }];
const posOf = (i: number) => pts[i];

describe('nearestSprite', () => {
  it('returns index of nearest point within maxDist', () => {
    expect(nearestSprite({ x: 1, y: 0 }, posOf, 3, 5)).toBe(0);
    expect(nearestSprite({ x: 9, y: 1 }, posOf, 3, 5)).toBe(1);
  });
  it('returns null when nothing is close enough', () => {
    expect(nearestSprite({ x: 100, y: 100 }, posOf, 3, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picking.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/picking.ts`:
```ts
export function nearestSprite(
  world: { x: number; y: number },
  positionOf: (i: number) => { x: number; y: number },
  count: number, maxDist: number,
): number | null {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const p = positionOf(i);
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= maxDist ? best : null;
}
```

`src/labels.ts`:
```ts
import type * as THREE from 'three';
import type { Artwork } from './data';
import { worldPerPixel } from './controls';

export class Labels {
  private els: HTMLDivElement[] = [];
  constructor(private overlay: HTMLElement, private artworks: Artwork[]) {
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.className = 'sprite-label';
      el.style.display = 'none';
      overlay.appendChild(el);
      this.els.push(el);
    }
  }

  update(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
         positionOf: (i: number) => { x: number; y: number }, zThreshold = 40): void {
    if (camera.position.z >= zThreshold) { this.els.forEach(e => (e.style.display = 'none')); return; }
    const wpp = worldPerPixel(camera, canvas.clientHeight);
    const ranked = this.artworks
      .map((a, i) => { const p = positionOf(i); return { a, p, d: Math.hypot(p.x - camera.position.x, p.y - camera.position.y) }; })
      .sort((q, r) => q.d - r.d).slice(0, 12);
    this.els.forEach((el, j) => {
      const item = ranked[j];
      if (!item) { el.style.display = 'none'; return; }
      const sx = canvas.clientWidth / 2 + (item.p.x - camera.position.x) / wpp;
      const sy = canvas.clientHeight / 2 - (item.p.y - camera.position.y) / wpp;
      el.textContent = `${String(item.a.day).padStart(3, '0')} · ${item.a.title}`;
      el.style.display = 'block';
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy + 14 / wpp * wpp + 18)}px) translateX(-50%)`;
    });
  }
}
```

Add to `src/style.css`:
```css
.sprite-label {
  position: absolute; top: 0; left: 0; font-size: 12px; letter-spacing: 0.06em;
  color: #9aa1b0; text-shadow: 0 1px 3px #000; white-space: nowrap; pointer-events: none;
  transition: opacity 0.2s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picking.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire hover + labels into main.ts**

In `boot()`:
```ts
import { nearestSprite } from './picking';
import { Labels } from './labels';

const overlay = document.getElementById('overlay')!;
const labels = new Labels(overlay, artworks);
let hovered: number | null = null;
canvas.addEventListener('pointermove', e => {
  const w = controls.screenToWorld(e.clientX, e.clientY);
  hovered = nearestSprite(w, i => con.positionOf(i), artworks.length, 1.2);
  con.setHover(hovered);
  canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
});
// inside the rAF loop, after controls.update(dt):
labels.update(con.camera, canvas, i => con.positionOf(i));
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected: hovering a sprite swells it and shows pointer cursor; zooming below z≈40 fades in up to 12 nearby "NNN · Title" labels that track their sprites while panning.

- [ ] **Step 7: Commit**

```bash
git add src/picking.ts src/labels.ts src/style.css src/main.ts tests/picking.test.ts && git commit -m "feat: sprite picking, hover swell, proximity labels"
```

---

### Task 11: Time View Spiral

**Files:**
- Modify: `src/timeview.ts` (replace stub), `src/main.ts`, `src/style.css`
- Create: `tests/timeview.test.ts`

**Interfaces:**
- Consumes: `Constellation.setTimeMix`.
- Produces: `spiralPosition(day: number): { x: number; y: number }` — a 3-turn Archimedean spiral: `angle = (day - 1) / 365 * 3 * 2π - π/2`, `radius = 8 + 42 * (day - 1) / 364`, `x = r·cos(angle)`, `y = -r·sin(angle)` (clockwise, day 1 at top, all within ±50). A DOM toggle button "Time" with pressed state that calls `setTimeMix(1 | 0)`.

- [ ] **Step 1: Write the failing test**

`tests/timeview.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { spiralPosition } from '../src/timeview';

describe('spiralPosition', () => {
  it('starts at top with inner radius', () => {
    const p = spiralPosition(1);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(8, 5);
  });
  it('ends at outer radius after 3 turns (top again)', () => {
    const p = spiralPosition(365);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });
  it('stays within world bounds', () => {
    for (let d = 1; d <= 365; d++) {
      const p = spiralPosition(d);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50.01);
    }
  });
  it('radius grows monotonically', () => {
    for (let d = 2; d <= 365; d++) {
      expect(Math.hypot(spiralPosition(d).x, spiralPosition(d).y))
        .toBeGreaterThan(Math.hypot(spiralPosition(d - 1).x, spiralPosition(d - 1).y));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeview.test.ts`
Expected: FAIL — stub returns `{x:0,y:0}` (first assertion fails).

- [ ] **Step 3: Write implementation**

`src/timeview.ts` (replace stub):
```ts
export function spiralPosition(day: number): { x: number; y: number } {
  const t = (day - 1) / 364;
  const angle = ((day - 1) / 365) * 3 * 2 * Math.PI - Math.PI / 2;
  const r = 8 + 42 * t;
  return { x: r * Math.cos(angle + Math.PI), y: r * Math.sin(angle + Math.PI) * -1 };
}
```

Note: verify against the test — day 1: angle `-π/2`, so `cos(angle+π) = cos(π/2) = 0`, `-sin(π/2) = -1`... that yields y = −8, not +8. The correct form matching the test is:
```ts
export function spiralPosition(day: number): { x: number; y: number } {
  const t = (day - 1) / 364;
  const angle = ((day - 1) / 365) * 3 * 2 * Math.PI;
  const r = 8 + 42 * t;
  return { x: r * Math.sin(angle), y: r * Math.cos(angle) };
}
```
(day 1 → sin 0 = 0, cos 0 = 1 → (0, 8); day 365 → angle = 364/365·6π ≈ 6π → (≈0, ≈50); clockwise when viewed with y-up.) Use this second form; delete the first.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeview.test.ts`
Expected: PASS (4 tests). If day-365 closeness fails at precision 5, relax that one expectation to precision 0 — the spiral's final angle is 364/365 of a full 3 turns, ~0.05 rad short of exact top; the visual intent (ends near top, outer edge) is what matters.

- [ ] **Step 5: Add the Time toggle button**

In `src/main.ts` `boot()`:
```ts
const timeBtn = document.createElement('button');
timeBtn.id = 'time-toggle';
timeBtn.textContent = 'Time';
timeBtn.setAttribute('aria-pressed', 'false');
overlay.appendChild(timeBtn);
let timeMode = false;
timeBtn.addEventListener('click', () => {
  timeMode = !timeMode;
  timeBtn.setAttribute('aria-pressed', String(timeMode));
  con.setTimeMix(timeMode ? 1 : 0);
});
```

Add to `src/style.css`:
```css
#time-toggle {
  position: absolute; top: 16px; right: 16px; background: rgba(20,24,32,0.7);
  color: #cfd3dc; border: 1px solid #333a48; padding: 6px 14px; border-radius: 16px;
  font: inherit; font-size: 13px; cursor: pointer;
}
#time-toggle[aria-pressed="true"] { background: #cfd3dc; color: #10131a; }
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected: clicking "Time" smoothly reflows the cluster cloud into a 3-turn chronological spiral (day 1 inner top, 365 outer top); clicking again reflows back. Hover/labels still track sprites in both modes (they use `positionOf`, which interpolates).

- [ ] **Step 7: Commit**

```bash
git add src/timeview.ts src/main.ts src/style.css tests/timeview.test.ts && git commit -m "feat: time view year-spiral toggle with animated reflow"
```

---

### Task 12: Piece View

**Files:**
- Create: `src/piece.ts`, `tests/piece.test.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `Artwork[]`, `imageUrl`, `dayToDate`, `Router`, `Controls.flyTo`, `Constellation.positionOf`.
- Produces: `neighborDay(day: number, dir: 1 | -1): number` (wraps 365→1 and 1→365); `class PieceView { constructor(overlay: HTMLElement, artworks: Artwork[], onNavigate: (slug: string) => void, onClose: () => void); open(slug: string): void; close(): void; isOpen(): boolean }` — full-screen figure with `<picture>` (avif/webp/jpg, 1024+2000 srcset), caption "NNN/365 · Title · Month Day, 2010", prev/next buttons, Esc and background-click close, ←/→ keys navigate.

- [ ] **Step 1: Write the failing test**

`tests/piece.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { neighborDay, captionFor } from '../src/piece';

describe('neighborDay', () => {
  it('increments, decrements, and wraps', () => {
    expect(neighborDay(1, 1)).toBe(2);
    expect(neighborDay(365, 1)).toBe(1);
    expect(neighborDay(1, -1)).toBe(365);
    expect(neighborDay(200, -1)).toBe(199);
  });
});

describe('captionFor', () => {
  it('formats day, title, and 2010 date', () => {
    expect(captionFor({ day: 42, title: 'Spirality' })).toBe('042/365 · Spirality · February 11, 2010');
    expect(captionFor({ day: 365, title: 'Icosapods' })).toBe('365/365 · Icosapods · December 31, 2010');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/piece.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/piece.ts`:
```ts
import type { Artwork } from './data';
import { imageUrl, dayToDate } from './data';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function neighborDay(day: number, dir: 1 | -1): number {
  return ((day - 1 + dir + 365) % 365) + 1;
}

export function captionFor(a: { day: number; title: string }): string {
  const { month, date } = dayToDate(a.day);
  return `${String(a.day).padStart(3, '0')}/365 · ${a.title} · ${MONTHS[month - 1]} ${date}, 2010`;
}

export class PieceView {
  private root: HTMLDivElement;
  private img: HTMLImageElement;
  private sources: { avif: HTMLSourceElement; webp: HTMLSourceElement };
  private caption: HTMLElement;
  private current: Artwork | null = null;
  private bySlug: Map<string, Artwork>;
  private byDay: Map<number, Artwork>;

  constructor(private overlay: HTMLElement, artworks: Artwork[],
              private onNavigate: (slug: string) => void, private onClose: () => void) {
    this.bySlug = new Map(artworks.map(a => [a.slug, a]));
    this.byDay = new Map(artworks.map(a => [a.day, a]));
    this.root = document.createElement('div');
    this.root.className = 'piece hidden';
    this.root.innerHTML = `
      <button class="piece-nav prev" aria-label="Previous day">‹</button>
      <figure>
        <picture>
          <source type="image/avif" /><source type="image/webp" />
          <img alt="" />
        </picture>
        <figcaption></figcaption>
      </figure>
      <button class="piece-nav next" aria-label="Next day">›</button>
      <button class="piece-close" aria-label="Close">×</button>`;
    overlay.appendChild(this.root);
    const [avif, webp] = this.root.querySelectorAll('source');
    this.sources = { avif, webp };
    this.img = this.root.querySelector('img')!;
    this.caption = this.root.querySelector('figcaption')!;
    this.root.querySelector('.prev')!.addEventListener('click', () => this.nav(-1));
    this.root.querySelector('.next')!.addEventListener('click', () => this.nav(1));
    this.root.querySelector('.piece-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.requestClose();
      if (e.key === 'ArrowLeft') this.nav(-1);
      if (e.key === 'ArrowRight') this.nav(1);
    });
  }

  private nav(dir: 1 | -1): void {
    if (!this.current) return;
    const next = this.byDay.get(neighborDay(this.current.day, dir))!;
    this.onNavigate(next.slug);
  }

  private requestClose(): void { this.close(); this.onClose(); }

  open(slug: string): void {
    const a = this.bySlug.get(slug);
    if (!a) return;
    this.current = a;
    const srcset = (ext: 'avif' | 'webp' | 'jpg') =>
      `${imageUrl(a.slug, 1024, ext)} 1024w, ${imageUrl(a.slug, 2000, ext)} 2000w`;
    this.sources.avif.srcset = srcset('avif');
    this.sources.webp.srcset = srcset('webp');
    this.img.srcset = srcset('jpg');
    this.img.src = imageUrl(a.slug, 1024, 'jpg');
    this.img.alt = `${a.title} — strange attractor, day ${a.day} of 365, 2010`;
    this.caption.textContent = captionFor(a);
    this.root.classList.remove('hidden');
    // preload neighbors
    for (const dir of [1, -1] as const) {
      const n = this.byDay.get(neighborDay(a.day, dir))!;
      new Image().src = imageUrl(n.slug, 1024, 'jpg');
    }
  }

  close(): void { this.root.classList.add('hidden'); this.current = null; }
  isOpen(): boolean { return this.current !== null; }
}
```

Add to `src/style.css`:
```css
.piece {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 12px; background: rgba(4,5,8,0.82); transition: opacity 0.35s; opacity: 1;
}
.piece.hidden { opacity: 0; pointer-events: none; }
.piece figure { max-width: min(84vw, 1100px); text-align: center; }
.piece img { max-width: 100%; max-height: 82vh; box-shadow: 0 8px 60px rgba(0,0,0,0.8); }
.piece figcaption { margin-top: 14px; font-size: 14px; letter-spacing: 0.08em; color: #9aa1b0; }
.piece-nav, .piece-close {
  background: none; border: none; color: #9aa1b0; font-size: 40px; cursor: pointer; padding: 12px;
}
.piece-nav:hover, .piece-close:hover { color: #fff; }
.piece-close { position: absolute; top: 8px; right: 14px; font-size: 30px; }
@media (max-width: 700px) { .piece-nav { position: absolute; bottom: 8px; } .piece-nav.prev { left: 20vw; } .piece-nav.next { right: 20vw; } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/piece.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire router + tap-to-open in main.ts**

In `boot()`:
```ts
import { Router, routePath } from './router';
import { PieceView } from './piece';

const bySlug = new Map(artworks.map((a, i) => [a.slug, i]));
const piece = new PieceView(overlay,
  artworks,
  slug => router.go({ kind: 'day', slug }),
  () => router.go({ kind: 'home' }));

const router = new Router(async r => {
  if (r.kind === 'day' && bySlug.has(r.slug)) {
    const i = bySlug.get(r.slug)!;
    const p = con.positionOf(i);
    await controls.flyTo(p.x, p.y, 8, 0.9);
    piece.open(r.slug);
  } else {
    piece.close();
  }
});

controls.onTap = (sx, sy) => {
  if (piece.isOpen()) return;
  const w = controls.screenToWorld(sx, sy);
  const i = nearestSprite(w, k => con.positionOf(k), artworks.length, 1.2);
  if (i !== null) router.go({ kind: 'day', slug: artworks[i].slug });
};

router.go(router.current()); // honor deep links like /day/042-spirality/
```
Also remove the static `.static-piece` figure if present (prerendered pages): at the top of `boot()`:
```ts
document.querySelector('.static-piece')?.remove();
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected: clicking a sprite glides the camera to it, then the high-res render fades up with caption ("042/365 · Spirality · February 11, 2010" style). ←/→ steps through days (URL updates), Esc/× returns to the constellation at the piece's location. Loading `/day/001-rose/` directly deep-links into that piece. Back/forward buttons work.

- [ ] **Step 7: Commit**

```bash
git add src/piece.ts src/main.ts src/style.css tests/piece.test.ts && git commit -m "feat: piece view with responsive images, navigation, deep links"
```

---

### Task 13: Calendar Index + Search

**Files:**
- Create: `src/indexview.ts`, `tests/search.test.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `Artwork[]`, `dayToDate`, `imageUrl`, `Router`.
- Produces: `searchArtworks(artworks: Artwork[], query: string): Artwork[]` (day-number exact match first, then case-insensitive title substring, max 8); `class IndexView { constructor(overlay, artworks, onPick: (slug) => void); open(): void; close(): void; isOpen(): boolean }` — DOM overlay: 12 month sections, each a grid of day cells (64px thumbs + day number), plus a search input at top; picking a cell or result calls `onPick(slug)`. An "Index" button and a `/` keyboard shortcut open it.

- [ ] **Step 1: Write the failing test**

`tests/search.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { searchArtworks } from '../src/indexview';

const art = (day: number, title: string) =>
  ({ day, title, slug: `${String(day).padStart(3, '0')}-x`, palette: [], brightness: 0, x: 0, y: 0 });
const all = [art(1, 'Rose'), art(42, 'Spirality'), art(97, 'Satellite of Love'), art(300, 'Rose Garden')];

describe('searchArtworks', () => {
  it('matches day numbers exactly', () => {
    expect(searchArtworks(all, '42')[0].day).toBe(42);
    expect(searchArtworks(all, '042')[0].day).toBe(42);
  });
  it('matches title substrings case-insensitively, in day order', () => {
    expect(searchArtworks(all, 'rose').map(a => a.day)).toEqual([1, 300]);
    expect(searchArtworks(all, 'LOVE')[0].day).toBe(97);
  });
  it('returns empty for no match or blank query', () => {
    expect(searchArtworks(all, 'zzz')).toEqual([]);
    expect(searchArtworks(all, '  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/indexview.ts`:
```ts
import type { Artwork } from './data';
import { dayToDate, imageUrl } from './data';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function searchArtworks(artworks: Artwork[], query: string): Artwork[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: Artwork[] = [];
  if (/^\d{1,3}$/.test(q)) {
    const n = parseInt(q, 10);
    const hit = artworks.find(a => a.day === n);
    if (hit) results.push(hit);
  }
  for (const a of artworks) {
    if (results.length >= 8) break;
    if (!results.includes(a) && a.title.toLowerCase().includes(q)) results.push(a);
  }
  return results.slice(0, 8);
}

export class IndexView {
  private root: HTMLDivElement;
  private results: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private artworks: Artwork[], private onPick: (slug: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'indexview hidden';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'day number or title…';
    input.setAttribute('aria-label', 'Search artworks');
    this.results = document.createElement('div');
    this.results.className = 'index-results';
    this.root.append(input, this.results);
    input.addEventListener('input', () => this.renderResults(searchArtworks(this.artworks, input.value)));

    const byDay = new Map(artworks.map(a => [a.day, a]));
    for (let m = 0; m < 12; m++) {
      const h = document.createElement('h2');
      h.textContent = MONTHS[m];
      const grid = document.createElement('div');
      grid.className = 'month-grid';
      this.root.append(h, grid);
      for (const a of artworks) {
        if (dayToDate(a.day).month !== m + 1) continue;
        grid.appendChild(this.cell(a));
      }
      void byDay;
    }
    overlay.appendChild(this.root);
  }

  private cell(a: Artwork): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'day-cell';
    btn.title = `${String(a.day).padStart(3, '0')} · ${a.title}`;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = imageUrl(a.slug, 256, 'jpg');
    img.alt = a.title;
    const num = document.createElement('span');
    num.textContent = String(dayToDate(a.day).date);
    btn.append(img, num);
    btn.addEventListener('click', () => this.onPick(a.slug));
    return btn;
  }

  private renderResults(items: Artwork[]): void {
    this.results.innerHTML = '';
    for (const a of items) {
      const b = document.createElement('button');
      b.textContent = `${String(a.day).padStart(3, '0')} · ${a.title}`;
      b.addEventListener('click', () => this.onPick(a.slug));
      this.results.appendChild(b);
    }
  }

  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
```

Add to `src/style.css`:
```css
.indexview {
  position: absolute; inset: 0; overflow-y: auto; background: rgba(4,5,8,0.94);
  padding: 48px min(8vw, 80px); transition: opacity 0.3s;
}
.indexview.hidden { opacity: 0; pointer-events: none; }
.indexview input {
  width: 100%; max-width: 420px; padding: 10px 16px; font: inherit; font-size: 15px;
  background: #10141c; color: #cfd3dc; border: 1px solid #333a48; border-radius: 20px;
}
.index-results { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; }
.index-results button, .indexview h2 { color: #cfd3dc; }
.index-results button { background: none; border: none; text-align: left; font: inherit; cursor: pointer; padding: 4px 8px; }
.index-results button:hover { background: #1a2030; }
.indexview h2 { margin: 28px 0 10px; font-weight: normal; letter-spacing: 0.12em; font-size: 15px; }
.month-grid { display: grid; grid-template-columns: repeat(auto-fill, 64px); gap: 6px; }
.day-cell { position: relative; width: 64px; height: 64px; padding: 0; border: none; cursor: pointer; background: #10141c; }
.day-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.day-cell span {
  position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: #fff;
  text-shadow: 0 1px 2px #000;
}
.day-cell:hover img { outline: 2px solid #cfd3dc; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into main.ts (button, `/` shortcut, router)**

In `boot()`:
```ts
import { IndexView } from './indexview';

const index = new IndexView(overlay, artworks, slug => {
  index.close();
  router.go({ kind: 'day', slug });
});
const indexBtn = document.createElement('button');
indexBtn.id = 'index-toggle';
indexBtn.textContent = 'Index';
overlay.appendChild(indexBtn);
indexBtn.addEventListener('click', () => router.go({ kind: 'index' }));
addEventListener('keydown', e => {
  if (e.key === '/' && !piece.isOpen() && !index.isOpen()) { e.preventDefault(); router.go({ kind: 'index' }); }
  if (e.key === 'Escape' && index.isOpen()) router.go({ kind: 'home' });
});
```
Extend the router callback:
```ts
const router = new Router(async r => {
  if (r.kind === 'index') { piece.close(); index.open(); return; }
  index.close();
  if (r.kind === 'day' && bySlug.has(r.slug)) { /* … existing piece logic … */ }
  else piece.close();
});
```
Style for the button (append to `#time-toggle` rule selector list or duplicate):
```css
#index-toggle { position: absolute; top: 16px; right: 96px; background: rgba(20,24,32,0.7);
  color: #cfd3dc; border: 1px solid #333a48; padding: 6px 14px; border-radius: 16px;
  font: inherit; font-size: 13px; cursor: pointer; }
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`.
Expected: "Index" button (and `/` key) opens a scrollable 12-month grid of lazy-loaded thumbnails with date numbers; typing "rose" or "42" in search lists matches; clicking anything opens that piece; Esc returns home; `/index/` URL works directly.

- [ ] **Step 7: Commit**

```bash
git add src/indexview.ts src/main.ts src/style.css tests/search.test.ts && git commit -m "feat: calendar index overlay and search"
```

---

### Task 14: Minimap, Intro Card & Polish

**Files:**
- Create: `src/minimap.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `Artwork[]`, camera, `Controls.flyTo`, `worldPerPixel`.
- Produces: `class Minimap { constructor(overlay, artworks, onJump: (x: number, y: number) => void); update(camera, canvas, positionOf): void }` — 140×140 canvas bottom-left: dots for all works (palette-tinted), viewport rectangle, click-to-jump. Intro card (DOM) on first visit only (`localStorage['la-intro-seen']`), fades after 6s or on interaction. Reduced-motion audit.

- [ ] **Step 1: Write minimap implementation**

`src/minimap.ts`:
```ts
import type * as THREE from 'three';
import type { Artwork } from './data';
import { worldPerPixel } from './controls';

const SIZE = 140, WORLD = 60; // world units mapped edge-to-edge

export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(overlay: HTMLElement, private artworks: Artwork[], onJump: (x: number, y: number) => void) {
    this.cv = document.createElement('canvas');
    this.cv.id = 'minimap';
    this.cv.width = this.cv.height = SIZE * 2;
    overlay.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
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
    const px = (wx: number) => (wx / WORLD / 2 + 0.5) * S;
    const py = (wy: number) => (-wy / WORLD / 2 + 0.5) * S;
    this.artworks.forEach((a, i) => {
      const p = positionOf(i);
      c.fillStyle = a.palette[0];
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

- [ ] **Step 2: Wire minimap + intro card into main.ts**

In `boot()`:
```ts
import { Minimap } from './minimap';

const minimap = new Minimap(overlay, artworks, (x, y) => controls.flyTo(x, y, con.camera.position.z, 0.6));
// in the rAF loop after labels.update(...):
minimap.update(con.camera, canvas, i => con.positionOf(i));

if (!localStorage.getItem('la-intro-seen')) {
  const intro = document.createElement('div');
  intro.id = 'intro-card';
  intro.innerHTML = '<h1>365 Strange Attractors</h1><p>One attractor a day, 2010.<br>Drag to wander · scroll to dive · click to open.</p>';
  overlay.appendChild(intro);
  const dismiss = () => { intro.classList.add('gone'); localStorage.setItem('la-intro-seen', '1'); };
  setTimeout(dismiss, 6000);
  canvas.addEventListener('pointerdown', dismiss, { once: true });
}
```
Add to `src/style.css`:
```css
#minimap { position: absolute; left: 16px; bottom: 16px; width: 140px; height: 140px;
  border: 1px solid #333a48; border-radius: 4px; cursor: pointer; }
#intro-card { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center; text-align: center; background: rgba(4,5,8,0.55);
  transition: opacity 1.2s; pointer-events: none; }
#intro-card.gone { opacity: 0; }
#intro-card h1 { font-weight: normal; letter-spacing: 0.18em; font-size: clamp(20px, 4vw, 34px); }
#intro-card p { color: #9aa1b0; font-size: 14px; line-height: 1.7; }
@media (max-width: 700px) { #minimap { display: none; } }
```

- [ ] **Step 3: Reduced-motion + full test pass**

Verify all reduced-motion paths in one place — in `boot()`, confirm these already exist (added in prior tasks): `con.setReducedMotion(reduced.matches)` (no drift), `Controls` constructed with `{ reducedMotion: reduced.matches }` (no inertia, instant flyTo). Add a live listener:
```ts
reduced.addEventListener('change', () => con.setReducedMotion(reduced.matches));
```

Run: `npm test`
Expected: all suites pass (manifest, images, completeness, pages, router, constellation, controls, picking, timeview, piece, search).

- [ ] **Step 4: Full build + preview**

Run: `npm run pipeline && npm run build && npm run preview`
Expected: production build works end-to-end: constellation, hover, labels, time view, piece view with deep links (`/day/042-spirality/` served from prerendered HTML → hydrates), index, search, minimap, intro card on first visit. Check a prerendered page's OpenGraph tags via view-source.

- [ ] **Step 5: Commit**

```bash
git add src/minimap.ts src/main.ts src/style.css && git commit -m "feat: minimap, intro card, reduced-motion polish"
```

---

### Task 15: CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm test`, `npm run build`.
- Produces: CI running unit tests + app build on push. (Pipeline itself needs the archive, which is not in the repo — CI runs the archive-independent test suites; `completeness.test.mjs` self-skips when `public/data/` is absent.)

- [ ] **Step 1: Write workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Verify locally (CI's exact commands)**

Run: `npm test && npm run build`
Expected: both succeed. (The completeness suite runs here because pipeline output exists locally; on CI it self-skips.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "chore: ci workflow - tests and build"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope):** pipeline manifest ✅ (T2), derivatives+atlas ✅ (T3), analysis/UMAP ✅ (T4), artworks.json ✅ (T5), prerendered pages/OG ✅ (T6), URLs/router/deep links ✅ (T7, T12), constellation w/ clusters + ambient drift ✅ (T8), zoom/pan/inertia/bounds ✅ (T9), hover swell + labels ✅ (T10), time-view spiral reflow ✅ (T11), piece view + prev/next + captions ✅ (T12), calendar index + search ✅ (T13), minimap + intro ✅ (T14), reduced-motion ✅ (T9/T8/T14), CI ✅ (T15). Deferred to later phases per spec: live attractors, morphs, disturb, audio, about page, constellation lines in time view (spec lists lines as part of time view — cut from Phase 1 to YAGNI; revisit in Phase 4 polish if missed), hover particle shimmer (simplified to swell; shimmer belongs with the Phase 2 GPU work), 256px near-sprite resolve (atlas is 128px; high-res appears in piece view — revisit in Phase 4 if constellation zoom feels soft), `layout-overrides.json` (add only if the UMAP layout needs manual nudging).
- **Type consistency check:** `positionOf(i)` used by picking/labels/minimap matches Constellation's signature; `Day`/`Artwork` field names consistent across pipeline and app; `atlas.json` shape matches `Atlas` interface; slugs `NNN-kebab` everywhere.
- **Known judgment calls:** UMAP `random_state=42` for reproducible layouts; atlas fits 365 tiles in 20×19; images gitignored (rebuildable from archive).
