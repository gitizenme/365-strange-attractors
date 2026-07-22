# Shareability Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rich social cards, favicon, sitemap, and author attribution for chaosofzen.dev, with all page-head metadata generated from a single source of truth.

**Architecture:** A new `pipeline/site.mjs` module holds site constants and a `metaTags()` renderer. Day pages (`pipeline/pages.mjs`) and the Vite-built root page (via a `transformIndexHtml` plugin) both render their heads from it. Three new idempotent pipeline steps emit the OG card (cropped 2010 mosaic), favicons, and sitemap into `public/`, where they are tracked in git so CI deploys carry them.

**Tech Stack:** Node ESM pipeline, sharp, png-to-ico (new dev dep), Vite 8, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-shareability-quick-wins-design.md`

## Global Constraints

- `ORIGIN` is exactly `https://chaosofzen.dev` (no trailing slash).
- Site description, verbatim: `One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file.`
- Author: `Joe Chavez`.
- OG card: 1200×630 JPEG from archive `mosaic/365_Moaic_No_Watermark.png`.
- Favicon source: archive `generated/086_Medusa.jpg`.
- All og/twitter/canonical URLs absolute. No runtime (src/) code changes.
- The archive (`..` relative to project root) is read-only input; never write to it.
- Working branch: `feat/shareability` created from `docs/shareability-spec`.

---

### Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Create the working branch**

```bash
cd "/Users/joe/Pictures/Art/365 Strange Attractors/website"
git checkout docs/shareability-spec
git checkout -b feat/shareability
```

Expected: `Switched to a new branch 'feat/shareability'`

---

### Task 1: `pipeline/site.mjs` — constants, `esc`, `metaTags()`

**Files:**
- Create: `pipeline/site.mjs`
- Test: `tests/site.test.mjs`

**Interfaces:**
- Produces: `ORIGIN: string`, `SITE_TITLE: string`, `SITE_DESCRIPTION: string`, `AUTHOR: string`, `CARD_IMAGE: { path, width, height, alt }`, `esc(s: string): string`, `metaTags({ title, description, image: { path, width?, height?, alt? }, url, type }): string`. Tasks 2, 3, and 6 consume these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/site.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { ORIGIN, SITE_TITLE, SITE_DESCRIPTION, AUTHOR, CARD_IMAGE, esc, metaTags } from '../pipeline/site.mjs';

describe('site constants', () => {
  it('are the agreed values', () => {
    expect(ORIGIN).toBe('https://chaosofzen.dev');
    expect(SITE_TITLE).toBe('365 Strange Attractors');
    expect(SITE_DESCRIPTION).toBe('One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file.');
    expect(AUTHOR).toBe('Joe Chavez');
    expect(CARD_IMAGE).toEqual({
      path: '/og/card.jpg', width: 1200, height: 630,
      alt: 'Photomosaic of all 365 strange attractors forming the numerals 365',
    });
  });
});

describe('metaTags', () => {
  const html = metaTags({
    title: 'Test Title', description: 'A description.',
    image: CARD_IMAGE, url: '/', type: 'website',
  });
  it('emits description, author, canonical', () => {
    expect(html).toContain('<meta name="description" content="A description." />');
    expect(html).toContain('<meta name="author" content="Joe Chavez" />');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/" />');
  });
  it('emits absolute og tags', () => {
    expect(html).toContain('<meta property="og:site_name" content="365 Strange Attractors" />');
    expect(html).toContain('<meta property="og:title" content="Test Title" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:url" content="https://chaosofzen.dev/" />');
    expect(html).toContain('<meta property="og:image" content="https://chaosofzen.dev/og/card.jpg" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain('<meta property="og:image:alt" content="Photomosaic of all 365 strange attractors forming the numerals 365" />');
  });
  it('emits twitter card tags', () => {
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="twitter:title" content="Test Title" />');
    expect(html).toContain('<meta name="twitter:image" content="https://chaosofzen.dev/og/card.jpg" />');
  });
  it('emits favicon links', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });
  it('omits og:image:width/height when image has no dimensions', () => {
    const h = metaTags({ title: 'T', description: 'D', image: { path: '/images/1024/x.jpg', alt: 'A' }, url: '/day/x/', type: 'article' });
    expect(h).not.toContain('og:image:width');
    expect(h).toContain('<meta property="og:image" content="https://chaosofzen.dev/images/1024/x.jpg" />');
    expect(h).toContain('<meta property="og:type" content="article" />');
  });
  it('escapes html in title and description', () => {
    const h = metaTags({ title: 'A<B&C"D', description: 'x', image: CARD_IMAGE, url: '/', type: 'website' });
    expect(h).toContain('content="A&lt;B&amp;C&quot;D"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/site.test.mjs`
Expected: FAIL — `Cannot find module '../pipeline/site.mjs'`

- [ ] **Step 3: Write the implementation**

Create `pipeline/site.mjs`:

```js
export const ORIGIN = 'https://chaosofzen.dev';
export const SITE_TITLE = '365 Strange Attractors';
export const SITE_DESCRIPTION = 'One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file.';
export const AUTHOR = 'Joe Chavez';
export const CARD_IMAGE = {
  path: '/og/card.jpg', width: 1200, height: 630,
  alt: 'Photomosaic of all 365 strange attractors forming the numerals 365',
};

export const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const abs = p => p.startsWith('http') ? p : ORIGIN + p;

export function metaTags({ title, description, image, url, type }) {
  const lines = [
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="author" content="${esc(AUTHOR)}" />`,
    `<link rel="canonical" href="${abs(url)}" />`,
    `<meta property="og:site_name" content="${esc(SITE_TITLE)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:url" content="${abs(url)}" />`,
    `<meta property="og:image" content="${abs(image.path)}" />`,
  ];
  if (image.width && image.height) {
    lines.push(`<meta property="og:image:width" content="${image.width}" />`);
    lines.push(`<meta property="og:image:height" content="${image.height}" />`);
  }
  if (image.alt) lines.push(`<meta property="og:image:alt" content="${esc(image.alt)}" />`);
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${abs(image.path)}" />`,
    `<link rel="icon" href="/favicon.ico" sizes="32x32" />`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
  );
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/site.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add pipeline/site.mjs tests/site.test.mjs
git commit -m "feat: add site metadata module (constants + metaTags renderer)"
```

---

### Task 2: Day pages render their head via `metaTags()`

**Files:**
- Modify: `pipeline/pages.mjs`
- Test: `tests/pages.test.mjs`

**Interfaces:**
- Consumes: `esc`, `metaTags` from `pipeline/site.mjs` (Task 1).
- Produces: `renderPiecePage(a)` unchanged signature; head now contains absolute og/twitter/canonical tags.

- [ ] **Step 1: Extend the existing test**

In `tests/pages.test.mjs`, replace the first `it(...)` block's og assertions and add absolute-URL assertions. The full updated file:

```js
import { describe, it, expect } from 'vitest';
import { renderPiecePage } from '../pipeline/pages.mjs';

const art = { day: 42, title: 'Spirality', slug: '042-spirality', palette: ['#112233','#223344','#334455','#445566','#556677'], brightness: 0.4, x: 1, y: 2 };

describe('renderPiecePage', () => {
  const html = renderPiecePage(art);
  it('includes title, day, image sources, app script', () => {
    expect(html).toContain('<title>Spirality — 042/365 Strange Attractors</title>');
    expect(html).toContain('srcset="/images/1024/042-spirality.avif 1024w, /images/2000/042-spirality.avif 2000w"');
    expect(html).toContain('src="/images/1024/042-spirality.jpg"');
    expect(html).toContain('alt="Spirality — strange attractor, day 42 of 365, 2010"');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).toContain('href="/assets/index.css"'); // must match vite's actual build output name
  });
  it('has absolute og/twitter/canonical metadata', () => {
    expect(html).toContain('<meta property="og:title" content="Spirality — 042/365 Strange Attractors" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta property="og:url" content="https://chaosofzen.dev/day/042-spirality/" />');
    expect(html).toContain('<meta property="og:image" content="https://chaosofzen.dev/images/1024/042-spirality.jpg" />');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/day/042-spirality/" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="description" content="Spirality, a strange attractor created on day 42 of 365 in 2010." />');
    expect(html).toContain('<meta name="author" content="Joe Chavez" />');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
  });
  it('escapes html in titles', () => {
    expect(renderPiecePage({ ...art, title: 'A<B&C' })).toContain('A&lt;B&amp;C');
  });
});
```

- [ ] **Step 2: Run test to verify the new assertions fail**

Run: `npx vitest run tests/pages.test.mjs`
Expected: FAIL on `og:url` / canonical / twitter assertions (old relative tags still present)

- [ ] **Step 3: Update `pipeline/pages.mjs`**

Replace the whole file (removes the local `esc`, imports from site.mjs, swaps the head):

```js
import { esc, metaTags } from './site.mjs';

export function renderPiecePage(a) {
  const num = String(a.day).padStart(3, '0');
  const t = esc(a.title);
  const name = `${t} — ${num}/365`;
  const srcset = ext => `/images/1024/${a.slug}.${ext} 1024w, /images/2000/${a.slug}.${ext} 2000w`;
  const head = metaTags({
    title: `${a.title} — ${num}/365 Strange Attractors`,
    description: `${a.title}, a strange attractor created on day ${a.day} of 365 in 2010.`,
    image: { path: `/images/1024/${a.slug}.jpg`, alt: `${a.title} — strange attractor, day ${a.day} of 365, 2010` },
    url: `/day/${a.slug}/`,
    type: 'article',
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} Strange Attractors</title>
${head}
<link rel="stylesheet" href="/assets/index.css" />
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

Note: raw `a.title` (not pre-escaped `t`) goes into `metaTags`, which escapes internally — pre-escaping would double-escape.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites (pages, site, and everything untouched)

- [ ] **Step 5: Commit**

```bash
git add pipeline/pages.mjs tests/pages.test.mjs
git commit -m "feat: day pages get absolute og/twitter/canonical metadata from site.mjs"
```

---

### Task 3: Root page head injection via Vite plugin

**Files:**
- Create: `pipeline/inject-head.mjs`
- Modify: `index.html`, `vite.config.ts`
- Test: `tests/inject-head.test.mjs`

**Interfaces:**
- Consumes: `metaTags`, `SITE_TITLE`, `SITE_DESCRIPTION`, `CARD_IMAGE` from `pipeline/site.mjs`.
- Produces: `injectHead(html: string): string` — replaces the `<!-- site-head -->` placeholder.

- [ ] **Step 1: Write the failing test**

Create `tests/inject-head.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { injectHead } from '../pipeline/inject-head.mjs';

describe('injectHead', () => {
  it('replaces the placeholder with site metadata', () => {
    const out = injectHead('<head><!-- site-head --></head>');
    expect(out).not.toContain('site-head');
    expect(out).toContain('<meta name="description" content="One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file." />');
    expect(out).toContain('<meta property="og:type" content="website" />');
    expect(out).toContain('<meta property="og:image" content="https://chaosofzen.dev/og/card.jpg" />');
    expect(out).toContain('<link rel="canonical" href="https://chaosofzen.dev/" />');
    expect(out).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
  });
  it('the real index.html contains the placeholder', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<!-- site-head -->');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inject-head.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `pipeline/inject-head.mjs`:

```js
import { metaTags, SITE_TITLE, SITE_DESCRIPTION, CARD_IMAGE } from './site.mjs';

export function injectHead(html) {
  const head = metaTags({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    image: CARD_IMAGE,
    url: '/',
    type: 'website',
  });
  return html.replace('<!-- site-head -->', head);
}
```

In `index.html`, add the placeholder line after `<title>`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>365 Strange Attractors</title>
  <!-- site-head -->
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <canvas id="gl"></canvas>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

Replace `vite.config.ts` with:

```ts
import { defineConfig } from 'vite';
import { injectHead } from './pipeline/inject-head.mjs';

export default defineConfig({
  appType: 'spa',
  plugins: [{ name: 'site-head', transformIndexHtml: html => injectHead(html) }],
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

- [ ] **Step 4: Run tests, then verify the built output**

Run: `npx vitest run`
Expected: PASS

Run: `npm run build && grep -c 'og:' dist/index.html`
Expected: build succeeds; grep prints a count ≥ 8

- [ ] **Step 5: Commit**

```bash
git add pipeline/inject-head.mjs tests/inject-head.test.mjs index.html vite.config.ts
git commit -m "feat: inject site-wide social metadata into root page at build time"
```

---

### Task 4: OG card builder (`buildOgCard`)

**Files:**
- Create: `pipeline/social.mjs`
- Test: `tests/social.test.mjs`

**Interfaces:**
- Produces: `buildOgCard(srcPath: string, outPath: string): Promise<void>` — writes a 1200×630 JPEG; throws if `srcPath` missing. Also (Task 5) `buildFavicons(srcPath, outRoot)`. Task 6 wires both into `build.mjs`.

- [ ] **Step 1: Write the failing test**

Create `tests/social.test.mjs`:

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildOgCard } from '../pipeline/social.mjs';

const dir = mkdtempSync(join(tmpdir(), 'social-'));
const src = join(dir, 'mosaic.png');

beforeAll(async () => {
  // synthetic stand-in for the real mosaic (any large-ish image)
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 10, b: 60 } } })
    .png().toFile(src);
});

describe('buildOgCard', () => {
  it('writes a 1200x630 jpeg', async () => {
    const out = join(dir, 'og', 'card.jpg');
    await buildOgCard(src, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe('jpeg');
  });
  it('throws when the source is missing', async () => {
    await expect(buildOgCard(join(dir, 'nope.png'), join(dir, 'x.jpg')))
      .rejects.toThrow(/og card source missing/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/social.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `pipeline/social.mjs`:

```js
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Crop position for the OG card. 'attention' biases toward the busiest region;
// adjust to 'centre' or an explicit extract if the visual check (build.mjs step)
// shows the numerals clipped.
export const OG_CROP_POSITION = 'attention';

export async function buildOgCard(srcPath, outPath) {
  if (!existsSync(srcPath)) throw new Error(`og card source missing: ${srcPath}`);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(srcPath)
    .resize(1200, 630, { fit: 'cover', position: OG_CROP_POSITION })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/social.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/social.mjs tests/social.test.mjs
git commit -m "feat: add OG card builder (1200x630 crop of the 2010 mosaic)"
```

---

### Task 5: Favicon builder (`buildFavicons`)

**Files:**
- Modify: `pipeline/social.mjs`, `package.json` (new dev dep)
- Test: `tests/social.test.mjs`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `buildFavicons(srcPath: string, outRoot: string): Promise<void>` — writes `favicon.ico`, `icon.svg`, `apple-touch-icon.png` into `outRoot`; throws if `srcPath` missing.

- [ ] **Step 1: Install the ico encoder**

```bash
npm i -D png-to-ico
```

Expected: `added 1 package` (approximately; it has no transitive deps of note)

- [ ] **Step 2: Write the failing test**

Append to `tests/social.test.mjs` (inside the same file, after the `buildOgCard` describe):

```js
import { readFileSync } from 'node:fs';
import { buildFavicons } from '../pipeline/social.mjs';

describe('buildFavicons', () => {
  it('writes favicon.ico, icon.svg, apple-touch-icon.png', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fav-'));
    await buildFavicons(src, out);

    const ico = readFileSync(join(out, 'favicon.ico'));
    expect([ico[0], ico[1], ico[2], ico[3]]).toEqual([0, 0, 1, 0]); // ICO header

    const svg = readFileSync(join(out, 'icon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('data:image/png;base64,');

    const apple = await sharp(join(out, 'apple-touch-icon.png')).metadata();
    expect(apple.width).toBe(180);
    expect(apple.height).toBe(180);
    expect(apple.format).toBe('png');
  });
  it('throws when the source is missing', async () => {
    await expect(buildFavicons(join(dir, 'nope.jpg'), dir))
      .rejects.toThrow(/favicon source missing/);
  });
});
```

(`src`, `dir`, `mkdtempSync`, `tmpdir`, `join`, `sharp` are already imported/defined at the top of the file from Task 4.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/social.test.mjs`
Expected: FAIL — `buildFavicons` not exported

- [ ] **Step 4: Implement**

Append to `pipeline/social.mjs`:

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pngToIco from 'png-to-ico';

// Favicon renders on light browser chrome, so lift brightness of the dark artwork.
const FAVICON_BRIGHTNESS = 1.25;

export async function buildFavicons(srcPath, outRoot) {
  if (!existsSync(srcPath)) throw new Error(`favicon source missing: ${srcPath}`);
  mkdirSync(outRoot, { recursive: true });
  const base = sharp(srcPath)
    .resize(512, 512, { fit: 'cover' })
    .modulate({ brightness: FAVICON_BRIGHTNESS });

  await base.clone().resize(180, 180).png().toFile(join(outRoot, 'apple-touch-icon.png'));

  const png32 = await base.clone().resize(32, 32).png().toBuffer();
  writeFileSync(join(outRoot, 'favicon.ico'), await pngToIco(png32));

  const png64 = await base.clone().resize(64, 64).png().toBuffer();
  writeFileSync(join(outRoot, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${png64.toString('base64')}"/></svg>\n`);
}
```

(Move the two new fs/path imports up to merge with the existing `existsSync, mkdirSync` / `dirname` imports at the top of the file — one import statement per module.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/social.test.mjs`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add pipeline/social.mjs tests/social.test.mjs package.json package-lock.json
git commit -m "feat: add favicon builder (ico + svg + apple-touch from 086 Medusa)"
```

---

### Task 6: Sitemap renderer

**Files:**
- Create: `pipeline/sitemap.mjs`
- Test: `tests/sitemap.test.mjs`

**Interfaces:**
- Consumes: `ORIGIN` from `pipeline/site.mjs`; the `days` array shape from `manifest.mjs` (`[{ day, title, slug, sourceImage }]` — only `slug` is used).
- Produces: `renderSitemap(days: Array<{slug: string}>): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/sitemap.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderSitemap } from '../pipeline/sitemap.mjs';

describe('renderSitemap', () => {
  const xml = renderSitemap([{ slug: '001-rose' }, { slug: '002-event-horizon' }]);
  it('lists root plus every day, absolute', () => {
    expect(xml).toContain('<loc>https://chaosofzen.dev/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/001-rose/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/002-event-horizon/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });
  it('is a urlset document with xml declaration', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sitemap.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `pipeline/sitemap.mjs`:

```js
import { ORIGIN } from './site.mjs';

export function renderSitemap(days) {
  const urls = ['/', ...days.map(d => `/day/${d.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `<url><loc>${ORIGIN}${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sitemap.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/sitemap.mjs tests/sitemap.test.mjs
git commit -m "feat: add sitemap renderer (root + 365 day pages)"
```

---

### Task 7: Wire into `build.mjs`, generate assets, visual card check

**Files:**
- Modify: `pipeline/build.mjs`
- Create (generated, committed): `public/og/card.jpg`, `public/favicon.ico`, `public/icon.svg`, `public/apple-touch-icon.png`, `public/sitemap.xml`

**Interfaces:**
- Consumes: `buildOgCard`, `buildFavicons` (Tasks 4–5), `renderSitemap` (Task 6), existing `days` array and `ARCHIVE`/`OUT`/`force` variables in `build.mjs`.

- [ ] **Step 1: Add the pipeline steps**

In `pipeline/build.mjs`, add to the imports at the top:

```js
import { buildOgCard, buildFavicons } from './social.mjs';
import { renderSitemap } from './sitemap.mjs';
```

Append at the end of the file (after the attractors.json block):

```js
if (force || !existsSync(join(OUT, 'og', 'card.jpg'))) {
  await buildOgCard(join(ARCHIVE, 'mosaic', '365_Moaic_No_Watermark.png'), join(OUT, 'og', 'card.jpg'));
  console.log('og card written');
} else {
  console.log('og card cached');
}

if (force || !existsSync(join(OUT, 'favicon.ico'))) {
  await buildFavicons(join(ARCHIVE, 'generated', '086_Medusa.jpg'), OUT);
  console.log('favicons written');
} else {
  console.log('favicons cached');
}

writeFileSync(join(OUT, 'sitemap.xml'), renderSitemap(days));
console.log(`sitemap.xml: ${days.length + 1} urls`);
```

- [ ] **Step 2: Run the pipeline**

Run: `npm run pipeline`
Expected: existing steps report cached (`derivatives: 0 generated, 365 cached`), then `og card written`, `favicons written`, `sitemap.xml: 366 urls`. Exit 0.

- [ ] **Step 3: Visually check the OG card crop**

Open `public/og/card.jpg` (Read tool for an agent; Preview for a human). The "365" numerals of the mosaic must be visible and not clipped — the whole point of this card is that it reads "365" at thumbnail size.

If clipped: in `pipeline/social.mjs` change `OG_CROP_POSITION` to `'centre'`, then delete `public/og/card.jpg` and rerun `npm run pipeline` (do NOT use `--force` — that would needlessly regenerate all 365 image derivatives; deleting the one output file retriggers just this step). Recheck; iterate until the numerals read.

- [ ] **Step 4: Check favicon legibility**

Open `public/favicon.ico` / `public/apple-touch-icon.png`. The Medusa form should read as a distinct shape at small size, not a dark smudge. If too dark, raise `FAVICON_BRIGHTNESS` to `1.5`, delete `public/favicon.ico`, rerun `npm run pipeline`, recheck.

- [ ] **Step 5: Full test suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; vite build succeeds; `dist/` contains `og/card.jpg`, `favicon.ico`, `icon.svg`, `apple-touch-icon.png`, `sitemap.xml` (vite copies `public/` into `dist/`). Verify:

```bash
ls dist/og/card.jpg dist/favicon.ico dist/icon.svg dist/apple-touch-icon.png dist/sitemap.xml
```

- [ ] **Step 6: Commit (including the generated assets)**

```bash
git add pipeline/build.mjs public/og/card.jpg public/favicon.ico public/icon.svg public/apple-touch-icon.png public/sitemap.xml
git commit -m "feat: emit og card, favicons, and sitemap from the pipeline; track them in git"
```

Note: these paths are not matched by any `.gitignore` rule (only `public/data/`, `public/images/`, `public/day/` are ignored), so no `.gitignore` change is needed. Tracking them means CI's code-only deploy ships them.

---

### Task 8: Final verification & handoff

**Files:** none (verification only)

- [ ] **Step 1: Run everything**

```bash
npx vitest run && npm run build
```

Expected: full suite PASS, build clean.

- [ ] **Step 2: Verify the built root page head**

```bash
grep -o 'og:image" content="[^"]*"' dist/index.html
grep -c '<url>' dist/sitemap.xml
```

Expected: `og:image" content="https://chaosofzen.dev/og/card.jpg"` and `366`.

- [ ] **Step 3: Verify a built day page**

```bash
grep -o 'og:image" content="[^"]*"' dist/day/086-medusa/index.html
```

Expected: `og:image" content="https://chaosofzen.dev/images/1024/086-medusa.jpg"`

- [ ] **Step 4: Merge/PR decision**

Implementation complete — use superpowers:finishing-a-development-branch. Remaining rollout steps (user-gated, not part of this branch):

1. Merge to main → CI deploys root page meta, favicons, og card, sitemap.
2. Run `scripts/deploy.sh` locally to ship the regenerated day-page HTML (it prompts before pushing).
3. **User:** add `Sitemap: https://chaosofzen.dev/sitemap.xml` to robots.txt in the Cloudflare dashboard.
4. Paste `https://chaosofzen.dev/` and one day URL into Slack or https://www.opengraph.xyz/ and confirm cards render.
