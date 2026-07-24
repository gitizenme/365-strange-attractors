# Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic top-right pill buttons with a poetic bottom word-row (Today · Attractors · Sound · Story), give the front page a daily arrival moment (camera settles on today's glowing piece), and rename/reveal every piece-view action in the same vocabulary — per the approved spec `docs/superpowers/specs/2026-07-23-navigation-redesign-design.md`.

**Architecture:** New `src/nav.ts` (word-row) and `src/today.ts` (pure today-resolution + settle math) shrink `main.ts`'s ad-hoc chrome. `Router` gains new route kinds with legacy redirects via a `replace` option. `Constellation` gains a per-sprite glow attribute and an `atlasReady` promise; `Controls.flyTo` gains cancellable flights. Views become translucent veils (CSS); `StoryView` is a new small view. The pipeline emits static shell pages for the three veil routes and adds them to the sitemap.

**Tech Stack:** Vite, TypeScript, Vitest (`npm test` = `vitest run`), Three.js — same as the rest of the repo, no new dependencies.

## Global Constraints

- Nav words are exactly **Today · Attractors · Sound · Story**, bottom center, Georgia serif, real `<a>` links with router-intercepted clicks (spec §2).
- Settle flight: single ~2.5 s eased motion; today's sprite ends ~15% of viewport height; any pan/zoom/click cancels it instantly (spec §1).
- `prefers-reduced-motion`: no flight — instant framing on today (already handled by `Controls.flyTo`'s `reduced` path; must not regress).
- Deep links (`/day/…`, `/attractors/`, `/sound/`, `/story/`) never trigger the settle — home route only (spec §1).
- "Today" = visitor's **local** date mapped to the same month/day in 2010; **Feb 29 → Feb 28** (spec §1).
- Veils: index/music/story backgrounds become translucent (~0.78 opacity) with backdrop blur; the constellation keeps rendering behind them (spec §2).
- No disabled Listen buttons: the control renders only when the day's data has an `audio` field; absent = hidden (spec §3).
- Word-row, minimap, layout switch, and today-caption all hide while any veil or piece is open (spec §3).
- Legacy URLs `/index/` and `/music/` must keep working (client redirect via `history.replaceState`); `/about/` maps to `/story/`.
- House testing convention: pure functions get unit tests (TDD, red → green); DOM/GL/canvas behavior is verified live in the browser in Task 9. No jsdom.
- **Branch:** create `feat/navigation-redesign` from `main` AFTER `feat/constellation-weight-framing` (pass 2) merges — this plan consumes its `fitCamera`, `computeCloudBounds`, `atlas.files`, lazy views, and `uBrightness` uniform. First commit on the branch adds the spec + this plan (`git add docs/superpowers/specs/2026-07-23-navigation-redesign-design.md docs/superpowers/plans/2026-07-23-navigation-redesign.md && git commit -m "docs: navigation redesign spec + plan"`).
- **One deliberate spec deviation** (recorded here so reviewers don't flag it as drift): the piece caption's family line reads `system` from the already-loaded `attractors.json` at runtime instead of a pipeline-time join against the sonifier's `features.json`. Same visible result, zero extra requests, no cross-repo build coupling.

---

### Task 1: Router — new route kinds, legacy redirects, replace option

**Files:**
- Modify: `src/router.ts` (full file, 36 lines today)
- Test: `tests/router.test.ts:5-20` (the `parseRoute` and round-trip describes)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Route` union becomes `{kind:'home'} | {kind:'day';slug} | {kind:'today'} | {kind:'attractors'} | {kind:'sound'} | {kind:'story'}` (kinds `'index'`, `'music'`, `'about'` are GONE — Tasks 4-7 use the new kinds). `Router.go(r, opts?: { replace?: boolean })` uses `history.replaceState` when `opts.replace` is true. `parseRoute` maps legacy paths (`/index`→attractors, `/music`→sound, `/about`→story).

- [ ] **Step 1: Write the failing test**

Replace the two describes in `tests/router.test.ts` (lines 5-20) with:

```ts
describe('parseRoute', () => {
  it('parses all route kinds', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/day/042-spirality/')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/day/042-spirality')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/today/')).toEqual({ kind: 'today' });
    expect(parseRoute('/attractors/')).toEqual({ kind: 'attractors' });
    expect(parseRoute('/sound/')).toEqual({ kind: 'sound' });
    expect(parseRoute('/story/')).toEqual({ kind: 'story' });
    expect(parseRoute('/nonsense')).toEqual({ kind: 'home' });
  });
  it('maps legacy paths onto the new kinds', () => {
    expect(parseRoute('/index/')).toEqual({ kind: 'attractors' });
    expect(parseRoute('/music/')).toEqual({ kind: 'sound' });
    expect(parseRoute('/about/')).toEqual({ kind: 'story' });
  });
  it('round-trips through routePath onto canonical paths', () => {
    expect(routePath({ kind: 'day', slug: '001-rose' })).toBe('/day/001-rose/');
    expect(routePath({ kind: 'today' })).toBe('/today/');
    expect(parseRoute(routePath({ kind: 'attractors' }))).toEqual({ kind: 'attractors' });
    expect(parseRoute(routePath({ kind: 'sound' }))).toEqual({ kind: 'sound' });
    expect(parseRoute(routePath({ kind: 'story' }))).toEqual({ kind: 'story' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL — `/today/` parses to `{kind:'home'}`, `/attractors/` to `{kind:'home'}`, etc.

- [ ] **Step 3: Implement**

Replace the full contents of `src/router.ts`:

```ts
export type Route =
  | { kind: 'home' } | { kind: 'day'; slug: string } | { kind: 'today' }
  | { kind: 'attractors' } | { kind: 'sound' } | { kind: 'story' };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '');
  const day = p.match(/^\/day\/([0-9]{3}-[a-z0-9-]+)$/);
  if (day) return { kind: 'day', slug: day[1] };
  if (p === '/today') return { kind: 'today' };
  // legacy paths keep resolving so pre-redesign links never break; Router.go(current, {replace:true})
  // at boot rewrites the address bar onto the canonical path without adding a history entry
  if (p === '/attractors' || p === '/index') return { kind: 'attractors' };
  if (p === '/sound' || p === '/music') return { kind: 'sound' };
  if (p === '/story' || p === '/about') return { kind: 'story' };
  return { kind: 'home' };
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case 'home': return '/';
    case 'day': return `/day/${r.slug}/`;
    case 'today': return '/today/';
    case 'attractors': return '/attractors/';
    case 'sound': return '/sound/';
    case 'story': return '/story/';
  }
}

export class Router {
  private onChange: (r: Route) => void;
  constructor(onChange: (r: Route) => void) {
    this.onChange = onChange;
    window.addEventListener('popstate', () => this.onChange(this.current()));
  }
  current(): Route { return parseRoute(location.pathname); }
  go(r: Route, opts: { replace?: boolean } = {}): void {
    if (routePath(r) !== location.pathname) {
      if (opts.replace) history.replaceState(null, '', routePath(r));
      else history.pushState(null, '', routePath(r));
    }
    this.onChange(r);
  }
}
```

Note: `src/main.ts` still references the old kinds and will not compile until Task 5 — that's expected; `npx vitest run` doesn't type-check main.ts, and the suite is the gate for this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router.test.ts`
Expected: PASS (all describes, including the untouched dayToDate/imageUrl ones).

- [ ] **Step 5: Commit**

```bash
git add src/router.ts tests/router.test.ts
git commit -m "feat: router speaks today/attractors/sound/story with legacy redirects"
```

---

### Task 2: `src/today.ts` — today resolution, settle math, caption text

**Files:**
- Create: `src/today.ts`
- Test: create `tests/today.test.ts`

**Interfaces:**
- Consumes: `Artwork` and `dayToDate` from `src/data.ts` (unchanged).
- Produces: `dateToDay2010(month: number, date: number): number`; `resolveToday(now: Date, artworks: Artwork[]): Artwork`; `settleCamera(target: {x,y}, fovDeg: number, spriteWorldSize?, fraction?): {x,y,z}`; `todayCaption(a: {day,title}): { label: string; title: string }`. Task 5/6 (main.ts) consume all four.

- [ ] **Step 1: Write the failing test**

Create `tests/today.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dateToDay2010, resolveToday, settleCamera, todayCaption } from '../src/today';
import type { Artwork } from '../src/data';

const art = (day: number): Artwork =>
  ({ day, title: `t${day}`, slug: `${String(day).padStart(3, '0')}-x`, palette: [], brightness: 0, x: 0, y: 0 });
const artworks = Array.from({ length: 365 }, (_, i) => art(i + 1));

describe('dateToDay2010', () => {
  it('maps month/day onto 2010 day-of-year', () => {
    expect(dateToDay2010(1, 1)).toBe(1);
    expect(dateToDay2010(1, 31)).toBe(31);
    expect(dateToDay2010(2, 28)).toBe(59);
    expect(dateToDay2010(3, 1)).toBe(60);
    expect(dateToDay2010(7, 23)).toBe(204);
    expect(dateToDay2010(12, 31)).toBe(365);
  });
  it('maps leap-day Feb 29 onto Feb 28 (2010 had no Feb 29)', () => {
    expect(dateToDay2010(2, 29)).toBe(59);
  });
});

describe('resolveToday', () => {
  it('uses the local month/day', () => {
    expect(resolveToday(new Date(2026, 6, 23), artworks).day).toBe(204);
    expect(resolveToday(new Date(2028, 1, 29), artworks).day).toBe(59); // leap year
  });
});

describe('settleCamera', () => {
  it('centers on the target and picks z so the sprite fills the height fraction', () => {
    const s = settleCamera({ x: 3, y: -2 }, 50);
    expect(s.x).toBe(3);
    expect(s.y).toBe(-2);
    // sprite is 1.6 world units; 15% of viewport => visible height 1.6/0.15; z = h / (2 tan(fov/2))
    const expectedZ = (1.6 / 0.15) / (2 * Math.tan((50 * Math.PI) / 360));
    expect(s.z).toBeCloseTo(expectedZ, 5);
  });
});

describe('todayCaption', () => {
  it('renders the day label and title', () => {
    expect(todayCaption({ day: 204, title: 'Gumballs' }))
      .toEqual({ label: 'Day 204 · July 23', title: 'Gumballs' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/today.test.ts`
Expected: FAIL — cannot resolve `../src/today`.

- [ ] **Step 3: Implement**

Create `src/today.ts`:

```ts
import type { Artwork } from './data';
import { dayToDate } from './data';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// 2010 was not a leap year, so a visitor's Feb 29 maps to Feb 28's piece.
export function dateToDay2010(month: number, date: number): number {
  const d = month === 2 && date === 29 ? 28 : date;
  let n = 0;
  for (let m = 0; m < month - 1; m++) n += MONTH_DAYS[m];
  return n + d;
}

// The visitor's LOCAL date — it's their "today", not UTC's.
export function resolveToday(now: Date, artworks: Artwork[]): Artwork {
  const day = dateToDay2010(now.getMonth() + 1, now.getDate());
  return artworks.find(a => a.day === day)!;
}

// Constellation sprites are 1.6 world units tall (uSize at aScale 1). Pick the camera height (z)
// that makes the settled sprite fill `fraction` of the viewport's height, centered on it.
export function settleCamera(target: { x: number; y: number }, fovDeg: number,
                             spriteWorldSize = 1.6, fraction = 0.15): { x: number; y: number; z: number } {
  const visibleHeight = spriteWorldSize / fraction;
  return { x: target.x, y: target.y, z: visibleHeight / (2 * Math.tan((fovDeg * Math.PI) / 360)) };
}

export function todayCaption(a: { day: number; title: string }): { label: string; title: string } {
  const { month, date } = dayToDate(a.day);
  return { label: `Day ${String(a.day).padStart(3, '0')} · ${MONTHS[month - 1]} ${date}`, title: a.title };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/today.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/today.ts tests/today.test.ts
git commit -m "feat: today resolution, settle-camera math, and caption text"
```

---

### Task 3: Constellation — per-sprite glow + atlasReady

**Files:**
- Modify: `src/constellation.ts` (shaders, constructor, new members)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Constellation.setHighlight(index: number | null): void` and `readonly atlasReady: Promise<void>` (resolves when the small atlas tier has loaded). Task 6 (main.ts arrival) consumes both.

GL-only change — no unit test (house convention); live-verified in Task 9.

- [ ] **Step 1: Extend the shaders**

In `src/constellation.ts`, replace the `VERT` constant with:

```ts
const VERT = /* glsl */ `
uniform float uTime; uniform float uDrift; uniform float uMix; uniform float uSize;
attribute vec2 aPosA; attribute vec2 aPosB; attribute vec4 aUv; attribute float aScale;
attribute float aGlow;
varying vec2 vUv; varying float vGlow;
void main() {
  vec2 base = mix(aPosA, aPosB, uMix);
  vec2 drift = uDrift * 0.12 * vec2(sin(uTime * 0.11 + base.y * 0.7), cos(uTime * 0.13 + base.x * 0.7));
  vec3 world = vec3(base + drift + position.xy * uSize * aScale, 0.0);
  vUv = vec2(aUv.x + uv.x * aUv.z, aUv.y + uv.y * aUv.w);
  vGlow = aGlow * (0.7 + 0.3 * sin(uTime * 2.2));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;
```

and the `FRAG` constant with:

```ts
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBrightness;
varying vec2 vUv; varying float vGlow;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  gl_FragColor = vec4(min(c.rgb * uBrightness * (1.0 + 0.9 * vGlow), vec3(1.0)), c.a);
}`;
```

- [ ] **Step 2: Add the glow attribute and atlasReady**

Add two members below `private mix = 0; private targetMix = 0;`:

```ts
  private glow: Float32Array;
  private glowAttr: THREE.InstancedBufferAttribute;
  readonly atlasReady: Promise<void>;
```

In the constructor, right after `this.targetScales = new Float32Array(n).fill(1);` add:

```ts
    this.glow = new Float32Array(n);
```

Right after `geo.setAttribute('aScale', this.scaleAttr);` add:

```ts
    this.glowAttr = new THREE.InstancedBufferAttribute(this.glow, 1);
    geo.setAttribute('aGlow', this.glowAttr);
```

Replace the line `const smallTex = new THREE.TextureLoader().load(atlas.files.small);` with:

```ts
    let atlasLoaded!: () => void;
    this.atlasReady = new Promise<void>(res => { atlasLoaded = res; });
    const smallTex = new THREE.TextureLoader().load(atlas.files.small, () => atlasLoaded());
```

Add a method next to `setHover`:

```ts
  // At most one sprite glows (today's). The pulse itself is computed in the vertex shader from
  // uTime, so nothing per-frame happens on the CPU here.
  setHighlight(index: number | null): void {
    this.glow.fill(0);
    if (index !== null) this.glow[index] = 1;
    this.glowAttr.needsUpdate = true;
  }
```

- [ ] **Step 3: Run the suite (regression gate)**

Run: `npx vitest run`
Expected: everything that passed before still passes (constellation.test.ts covers `atlasUv`/`computeCloudBounds`, both untouched).

- [ ] **Step 4: Commit**

```bash
git add src/constellation.ts
git commit -m "feat: per-sprite glow attribute and atlasReady signal"
```

---

### Task 4: Veil views — StoryView, translucent CSS, index links, sonification teaser

**Files:**
- Create: `src/storyview.ts`
- Modify: `src/indexview.ts:55-78` (`cell` and `renderResults`)
- Modify: `src/musicview.ts:11-20` (template)
- Modify: `src/style.css` (`.indexview`, `.musicview`, `.day-cell`, `.index-results`, new `.storyview`)

**Interfaces:**
- Consumes: nothing from other tasks (works against current main.ts — IndexView/MusicView signatures unchanged).
- Produces: `new StoryView(overlay: HTMLElement, onClose: () => void)` with `open()/close()/isOpen()` — the exact same trio as MusicView. Task 5's router wiring consumes it.

- [ ] **Step 1: Create StoryView**

Create `src/storyview.ts`:

```ts
// The Story destination's interim page: factual description + attribution until the full 2010
// story (roadmap pass 3) replaces the body. Same open/close/Escape contract as MusicView.
export class StoryView {
  private root: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'storyview hidden';
    this.root.innerHTML = `
      <button class="story-close" aria-label="Return to the constellation" title="Return to the constellation"><span class="glyph">×</span> Sky</button>
      <div class="story-body">
        <h1>365 Strange Attractors</h1>
        <p>One strange attractor a day, every day of 2010 — 365 fractal works by Joe Chavez,
        each re-rendered live in your browser from its original 2010 parameter file.</p>
        <p class="story-more">The full story of the year is coming.</p>
      </div>`;
    overlay.appendChild(this.root);
    this.root.querySelector('.story-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (this.isOpen() && e.key === 'Escape') this.requestClose();
    });
  }

  private requestClose(): void { this.close(); this.onClose(); }
  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
```

- [ ] **Step 2: Index cells and search results become real links**

In `src/indexview.ts`, replace the `cell` method (lines 55-68) with:

```ts
  private cell(a: Artwork): HTMLElement {
    const link = document.createElement('a');
    link.className = 'day-cell';
    link.href = `/day/${a.slug}/`;
    link.title = `${String(a.day).padStart(3, '0')} · ${a.title}`;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = imageUrl(a.slug, 256, 'jpg');
    img.alt = a.title;
    const num = document.createElement('span');
    num.textContent = String(dayToDate(a.day).date);
    link.append(img, num);
    link.addEventListener('click', e => { e.preventDefault(); this.onPick(a.slug); });
    return link;
  }
```

and the `renderResults` method (lines 70-78) with:

```ts
  private renderResults(items: Artwork[]): void {
    this.results.innerHTML = '';
    for (const a of items) {
      const link = document.createElement('a');
      link.href = `/day/${a.slug}/`;
      link.textContent = `${String(a.day).padStart(3, '0')} · ${a.title}`;
      link.addEventListener('click', e => { e.preventDefault(); this.onPick(a.slug); });
      this.results.appendChild(link);
    }
  }
```

- [ ] **Step 3: Music view — Sky close + sonification teaser**

In `src/musicview.ts`, in the `innerHTML` template (lines 11-20), replace the close-button line

```html
      <button class="music-close" aria-label="Close" title="Close">×</button>
```

with

```html
      <button class="music-close" aria-label="Return to the constellation" title="Return to the constellation"><span class="glyph">×</span> Sky</button>
```

and insert directly after the closing `</div>` of `music-header` (before the `music-albums` section):

```html
      <section class="music-sonification"><h2>Sonification</h2>
        <p>Every day's attractor is composing its own music — the orbit writes the melody,
        the image chooses the key. Coming to each day's page.</p>
      </section>
```

- [ ] **Step 4: CSS — veils, link cells, storyview**

In `src/style.css`:

Replace the `.indexview` rule with:

```css
.indexview {
  position: absolute; inset: 0; overflow-y: auto; background: rgba(4,5,8,0.78);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  padding: 48px min(8vw, 80px); transition: opacity 0.3s;
}
```

Replace the `.index-results button, .indexview h2` and `.index-results button` and `.index-results button:hover` rules with:

```css
.index-results a, .indexview h2 { color: #cfd3dc; }
.index-results a { display: block; text-decoration: none; text-align: left; font: inherit; cursor: pointer; padding: 4px 8px; }
.index-results a:hover { background: #1a2030; }
```

Replace the `.day-cell` rule with:

```css
.day-cell { position: relative; display: block; width: 64px; height: 64px; padding: 0; border: none; cursor: pointer; background: #10141c; }
```

Replace the `.musicview` rule's `background` line — the rule becomes:

```css
.musicview {
  position: absolute; inset: 0; overflow-y: auto;
  background: rgba(10,12,18,0.8); color: #cfd3dc;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  padding: 48px 24px; box-sizing: border-box;
}
```

Replace the whole `.music-close` rule (the toggle row it dodged at top:64px is gone after Task 5) with:

```css
.music-close, .story-close {
  position: fixed; top: 16px; right: 16px; z-index: 2;
  font-family: inherit; font-size: 14px; letter-spacing: 0.18em;
  background: none; border: none; color: #9aa1b0; cursor: pointer; padding: 12px;
}
.music-close .glyph, .story-close .glyph { font-size: 18px; margin-right: 6px; vertical-align: -1px; }
.music-close:hover, .story-close:hover { color: #fff; }
```

Append at the end of the file:

```css
#overlay > .storyview.hidden { opacity: 0; pointer-events: none; }
.storyview {
  position: absolute; inset: 0; overflow-y: auto;
  background: rgba(10,12,18,0.8); color: #cfd3dc;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  padding: 48px 24px; box-sizing: border-box; transition: opacity 0.3s;
}
.story-body { max-width: 640px; margin: 10vh auto 0; text-align: center; }
.story-body h1 { font-weight: normal; letter-spacing: 0.18em; font-size: clamp(20px, 4vw, 30px); }
.story-body p { color: #9aa1b0; line-height: 1.7; margin-top: 18px; }
.story-more { font-style: italic; }
```

- [ ] **Step 5: Run the suite, then commit**

Run: `npx vitest run`
Expected: PASS (search.test.ts exercises `searchArtworks` only — untouched).

```bash
git add src/storyview.ts src/indexview.ts src/musicview.ts src/style.css
git commit -m "feat: veil styling, story view, index day-links, sonification teaser"
```

---

### Task 5: Word-row nav, layout switch, and the rewired router (main.ts)

**Files:**
- Create: `src/nav.ts`
- Modify: `src/main.ts` (chrome construction + router handler + keyboard)
- Modify: `index.html:12` (static nav inside `#overlay`)
- Modify: `src/style.css` (remove pill-button rules; add `#nav-row`, `#layout-switch`, `.view-open`)

**Interfaces:**
- Consumes: Task 1's `Route` kinds and `go(r, {replace})`; Task 4's `StoryView`.
- Produces: `new Nav(overlay, onGo: (kind) => void, opts: { hasSound: boolean })` with `setActive(kind | null)`. `#overlay` gains a `view-open` class whenever any non-home route is active — Task 6's caption and Task 7's mode toggle rely on that class existing.

- [ ] **Step 1: Create the Nav word-row**

Create `src/nav.ts`:

```ts
export type NavKind = 'today' | 'attractors' | 'sound' | 'story';

const ENTRIES: { kind: NavKind; label: string; title: string }[] = [
  { kind: 'today', label: 'Today', title: "Today — this date's attractor (or press t)" },
  { kind: 'attractors', label: 'Attractors', title: 'Attractors — browse all 365 days (or press /)' },
  { kind: 'sound', label: 'Sound', title: 'Sound — music from the attractors' },
  { kind: 'story', label: 'Story', title: 'Story — one attractor a day, 2010' },
];

// The four destinations as a serif word-row woven into the scene (bottom center). Real <a> links
// so middle-click/hover-preview/crawlers work; normal clicks are intercepted and routed.
export class Nav {
  private root: HTMLElement;
  private links = new Map<NavKind, HTMLAnchorElement>();

  constructor(overlay: HTMLElement, onGo: (kind: NavKind) => void, opts: { hasSound: boolean }) {
    this.root = document.createElement('nav');
    this.root.id = 'nav-row';
    for (const e of ENTRIES) {
      if (e.kind === 'sound' && !opts.hasSound) continue;
      const a = document.createElement('a');
      a.href = `/${e.kind}/`;
      a.textContent = e.label;
      a.title = e.title;
      a.addEventListener('click', ev => { ev.preventDefault(); onGo(e.kind); });
      this.root.appendChild(a);
      this.links.set(e.kind, a);
    }
    overlay.appendChild(this.root);
  }

  setActive(kind: NavKind | null): void {
    for (const [k, a] of this.links) a.classList.toggle('active', k === kind);
  }
}
```

- [ ] **Step 2: Static nav for crawlers in index.html**

In `index.html`, replace `  <div id="overlay"></div>` with:

```html
  <div id="overlay">
    <nav class="static-nav">
      <a href="/today/">Today</a>
      <a href="/attractors/">Attractors</a>
      <a href="/sound/">Sound</a>
      <a href="/story/">Story</a>
    </nav>
  </div>
```

- [ ] **Step 3: Rewire main.ts**

In `src/main.ts`:

3a. Add imports:

```ts
import { StoryView } from './storyview';
import { Nav } from './nav';
import { resolveToday } from './today';
```

3b. After the `document.querySelector('.static-piece')?.remove();` line, add:

```ts
  document.querySelector('.static-nav')?.remove(); // replaced by the live word-row below
```

3c. Delete the whole `timeBtn` block (from `const timeBtn = document.createElement('button');` through `});` of its click listener) and replace it with the demoted layout switch:

```ts
  // The date-vs-likeness arrangement is a way of viewing the sky, not a destination — a quiet
  // two-word switch by the minimap instead of a primary nav slot.
  const layoutSwitch = document.createElement('div');
  layoutSwitch.id = 'layout-switch';
  const likenessBtn = document.createElement('button');
  likenessBtn.textContent = 'Likeness';
  likenessBtn.title = 'Arrange the constellation by visual similarity';
  const dateBtn = document.createElement('button');
  dateBtn.textContent = 'Date';
  dateBtn.title = 'Arrange the constellation by calendar date';
  layoutSwitch.append(likenessBtn, dateBtn);
  overlay.appendChild(layoutSwitch);
  const setLayout = (byDate: boolean) => {
    likenessBtn.classList.toggle('active', !byDate);
    dateBtn.classList.toggle('active', byDate);
    likenessBtn.setAttribute('aria-pressed', String(!byDate));
    dateBtn.setAttribute('aria-pressed', String(byDate));
    con.setTimeMix(byDate ? 1 : 0);
  };
  likenessBtn.addEventListener('click', () => setLayout(false));
  dateBtn.addEventListener('click', () => setLayout(true));
  setLayout(false);
```

3d. Delete the `indexBtn` block (creation, appendChild, click listener) and the `musicBtn` block (creation, title, conditional append + listener — keep the `let music: MusicView | null | undefined = musicData ? undefined : null;` declaration and its comment). Add instead, right before the router construction:

```ts
  let story: StoryView | null = null;
  const nav = new Nav(overlay, kind => router.go({ kind }), { hasSound: !!musicData });
```

3e. Replace the keyboard listener (the `addEventListener('keydown', …)` block that handles `/` and Escape) with:

```ts
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return; // typing in the search field
    const viewOpen = piece.isOpen() || index?.isOpen() || music?.isOpen() || story?.isOpen();
    if (e.key === '/' && !viewOpen) { e.preventDefault(); router.go({ kind: 'attractors' }); }
    if (e.key === 't' && !viewOpen) router.go({ kind: 'today' });
    if (e.key === 'Escape' && index?.isOpen()) router.go({ kind: 'home' });
  });
```

3f. Replace the whole `const router = new Router(async r => { … });` block with:

```ts
  const router = new Router(async r => {
    // Scene chrome (word-row, minimap, layout switch, today caption) belongs to the scene:
    // hidden the moment any veil or piece takes over, back when the visitor returns home.
    overlay.classList.toggle('view-open', r.kind !== 'home');
    nav.setActive(r.kind === 'attractors' || r.kind === 'sound' || r.kind === 'story' ? r.kind : null);
    if (r.kind === 'today') {
      // /today/ is a resolver, not a place: replace onto the real day so a shared URL always
      // captures the specific piece, then let the day handler below run via the re-entrant go().
      router.go({ kind: 'day', slug: resolveToday(new Date(), artworks).slug }, { replace: true });
      return;
    }
    if (r.kind === 'sound') {
      piece.close(); index?.close(); story?.close();
      // First hit only (music === undefined): build the view now. A throw here disables the
      // section for the rest of the session (music = null). musicData is guaranteed non-null
      // here since music only starts `undefined` (not `null`) when it was.
      if (music === undefined) {
        try {
          music = new MusicView(overlay, musicData!, () => router.go({ kind: 'home' }));
        } catch (err) {
          console.error('MusicView failed to construct, disabling Sound section', err);
          music = null;
        }
      }
      music?.open();
      return;
    }
    music?.close();
    if (r.kind === 'attractors') {
      piece.close(); story?.close();
      (index ??= new IndexView(overlay, artworks, slug => { index!.close(); router.go({ kind: 'day', slug }); })).open();
      return;
    }
    index?.close();
    if (r.kind === 'story') {
      piece.close();
      (story ??= new StoryView(overlay, () => router.go({ kind: 'home' }))).open();
      return;
    }
    story?.close();
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

3g. Replace `router.go(router.current()); // honor deep links like /day/042-spirality/` with:

```ts
  // Honor deep links AND canonicalize legacy URLs (/index/, /music/, /about/) onto the new
  // paths without adding a history entry.
  router.go(router.current(), { replace: true });
```

3h. In the render loop's chrome condition, add story: replace `if (!piece.isOpen() && !index?.isOpen() && !music?.isOpen()) {` with:

```ts
    if (!piece.isOpen() && !index?.isOpen() && !music?.isOpen() && !story?.isOpen()) {
```

- [ ] **Step 4: CSS — word-row, layout switch, chrome hiding; remove pill buttons**

In `src/style.css`:

Delete these rules entirely: `#time-toggle`, `#time-toggle[aria-pressed="true"]`, `#index-toggle`, `#music-toggle` (and the long comment above it), and the `#time-toggle, #index-toggle, #music-toggle { z-index: 1; }` rule with its comment block.

Append:

```css
#nav-row {
  position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; white-space: nowrap;
  font-size: 14px; letter-spacing: 0.18em; transition: opacity 0.3s;
}
#nav-row a { color: #9aa1b0; text-decoration: none; padding: 6px 4px; }
#nav-row a:hover { color: #fff; text-shadow: 0 0 12px rgba(232,178,106,0.45); }
#nav-row a.active { color: #e6e9f0; border-bottom: 1px solid #4a5268; }
#nav-row a + a::before { content: '·'; margin: 0 14px; color: #4a5268; }

#layout-switch {
  position: absolute; left: 16px; bottom: 168px; display: flex;
  border: 1px solid #333a48; border-radius: 16px; overflow: hidden;
  background: rgba(20,24,32,0.7); transition: opacity 0.3s;
}
#layout-switch button {
  background: none; border: none; color: #9aa1b0; font: inherit; font-size: 12px;
  letter-spacing: 0.1em; padding: 5px 12px; cursor: pointer;
}
#layout-switch button.active { background: #cfd3dc; color: #10131a; }

/* The scene's chrome belongs to the scene — gone while any veil or piece is open. */
#overlay.view-open #nav-row, #overlay.view-open #minimap,
#overlay.view-open #layout-switch, #overlay.view-open #today-caption {
  opacity: 0; pointer-events: none;
}

/* crawler-only fallback nav; removed at boot, styled minimally in case JS never runs */
.static-nav { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); display: flex; gap: 20px; }
.static-nav a { color: #9aa1b0; }

@media (max-width: 700px) {
  #nav-row { font-size: 12px; bottom: 14px; }
  #nav-row a + a::before { margin: 0 8px; }
  #layout-switch { bottom: 64px; } /* minimap is hidden on mobile; sit above the word-row */
}
```

- [ ] **Step 5: Run the suite, then commit**

Run: `npx vitest run`
Expected: PASS. (Compile check: `npx tsc --noEmit` if configured — otherwise the Vite dev server in Task 9 is the type gate.)

```bash
git add src/nav.ts src/main.ts index.html src/style.css
git commit -m "feat: word-row nav, layout switch, and rewired routes"
```

---

### Task 6: The arrival — cancellable settle flight, glow, caption

**Files:**
- Modify: `src/controls.ts:133-148` (`flyTo`) and the pointerdown/wheel handlers
- Modify: `src/main.ts` (intro card → arrival sequence)
- Modify: `src/style.css` (`#today-caption`; remove `#intro-card` rules)

**Interfaces:**
- Consumes: Task 2's `resolveToday`/`settleCamera`/`todayCaption`; Task 3's `setHighlight`/`atlasReady`; Task 5's `view-open` class.
- Produces: `Controls.flyTo(x, y, z, durationSec, opts?: { cancellable?: boolean })` and `Controls.cancelFlight()`. Existing `flyTo` call sites (day route, minimap jump) pass no opts and behave exactly as before.

- [ ] **Step 1: Cancellable flights in Controls**

In `src/controls.ts`, add two private fields below `private userMoved = false;`:

```ts
  private flightId = 0;
  private cancellableFlight = false;
```

Replace the `flyTo` method with:

```ts
  // `cancellable` flights (the home-arrival settle) end instantly on any pan/zoom — the visitor
  // always wins. Non-cancellable flights (day-open, minimap jumps) behave exactly as before:
  // the router awaits them and input stays deferred until they land.
  flyTo(x: number, y: number, z: number, durationSec: number, opts: { cancellable?: boolean } = {}): Promise<void> {
    if (this.reduced) durationSec = 0;
    this.flying = true;
    this.cancellableFlight = opts.cancellable ?? false;
    const id = ++this.flightId;
    const from = { ...this.camera.position };
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = () => {
        if (this.flightId !== id) { resolve(); return; } // cancelled (or superseded) mid-flight
        const t = durationSec === 0 ? 1 : Math.min(1, (performance.now() - t0) / (durationSec * 1000));
        const k = ease(t);
        this.camera.position.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
        if (t < 1) requestAnimationFrame(step);
        else { this.flying = false; this.cancellableFlight = false; resolve(); }
      };
      step();
    });
  }

  cancelFlight(): void {
    if (this.flying && this.cancellableFlight) {
      this.flying = false;
      this.cancellableFlight = false;
      this.flightId++;
    }
  }
```

In the constructor's `pointerdown` handler, directly after `if (!this.enabled) return;` add:

```ts
      this.cancelFlight();
```

In the `wheel` handler, directly after `e.preventDefault();` (BEFORE the `if (this.flying) return;` line) add:

```ts
      this.cancelFlight();
```

- [ ] **Step 2: Replace the intro card with the arrival sequence**

In `src/main.ts`, add to the today import: `import { resolveToday, settleCamera, todayCaption } from './today';` (replacing Task 5's narrower import).

Delete the whole intro-card block (`if (!localStorage.getItem('la-intro-seen')) { … }` through its closing brace) and insert in its place:

```ts
  // The arrival: today's piece is the daily focal point. The sprite glows from boot; once the
  // small atlas tier is visible the camera makes one eased flight to it (home route only, and
  // only if the visitor hasn't already taken over). Reduced-motion visitors get instant framing
  // via flyTo's own duration-0 path.
  const todayArt = resolveToday(new Date(), artworks);
  const todayIndex = artworks.findIndex(a => a.day === todayArt.day);
  con.setHighlight(todayIndex);
  const captionEl = document.createElement('div');
  captionEl.id = 'today-caption';
  const cap = todayCaption(todayArt);
  const capSmall = document.createElement('small');
  capSmall.textContent = cap.label;
  const capTitle = document.createElement('span');
  capTitle.textContent = cap.title;
  captionEl.append(capSmall, capTitle);
  if (!localStorage.getItem('la-intro-seen')) {
    const hints = document.createElement('p');
    hints.className = 'today-hints';
    hints.textContent = 'drag to wander · scroll to dive · click to open';
    captionEl.appendChild(hints);
  }
  overlay.appendChild(captionEl);
  const dismissCaption = () => {
    captionEl.classList.remove('visible');
    localStorage.setItem('la-intro-seen', '1');
  };
  canvas.addEventListener('pointerdown', dismissCaption, { once: true });
  canvas.addEventListener('wheel', dismissCaption, { once: true });
```

Then, directly after the `router.go(router.current(), { replace: true });` line, add:

```ts
  const arrive = async () => {
    await con.atlasReady;
    if (controls.hasUserMoved() || router.current().kind !== 'home') return;
    const p = con.positionOf(todayIndex);
    const s = settleCamera(p, con.camera.fov);
    await controls.flyTo(s.x, s.y, s.z, 2.5, { cancellable: true });
    captionEl.classList.add('visible');
  };
  if (router.current().kind === 'home') arrive();
```

- [ ] **Step 3: CSS**

In `src/style.css`, delete the `#overlay > #intro-card`, `#intro-card.gone`, `#intro-card h1`, `#intro-card p` rules. Append:

```css
#today-caption {
  position: absolute; left: 50%; top: 62%; transform: translateX(-50%);
  text-align: center; color: #cfd3dc; opacity: 0; transition: opacity 0.8s;
  pointer-events: none;
}
#today-caption.visible { opacity: 1; }
#today-caption small {
  display: block; color: #8a92a6; font-size: 11px; letter-spacing: 0.18em;
  text-transform: uppercase; margin-bottom: 4px;
}
#today-caption span { font-size: 18px; letter-spacing: 0.08em; }
.today-hints { color: #9aa1b0; font-size: 12px; margin-top: 12px; letter-spacing: 0.06em; }
```

- [ ] **Step 4: Run the suite, then commit**

Run: `npx vitest run`
Expected: PASS (controls.test.ts covers the pure helpers — `stepInertia`/`clampCamera`/`fitCamera`/`zoomToward` — all untouched).

```bash
git add src/controls.ts src/main.ts src/style.css
git commit -m "feat: arrival settle flight onto today's glowing piece"
```

---

### Task 7: Piece-view actions — Sky, destination arrows, Image|Orbit, family line, Listen

**Files:**
- Modify: `src/data.ts:1-4` (`Artwork` gains `audio?`)
- Modify: `src/piece.ts` (template, `LiveDeps`, `open`/`close`, new `familyLabel`)
- Modify: `src/main.ts` (hide-image button → mode toggle)
- Modify: `src/style.css` (`.piece-close`, `.piece-nav` labels, `#mode-toggle`, caption meta, listen)
- Test: `tests/piece.test.ts` (append `familyLabel` describe)

**Interfaces:**
- Consumes: Task 5's `view-open` class (mode toggle is inside the overlay chrome but shown only while a piece is open, so it's exempted from `view-open` hiding via its own display logic).
- Produces: `familyLabel(system: string | undefined): string | null` (exported from piece.ts); `LiveDeps.modeToggle: HTMLElement` REPLACES `LiveDeps.hideImageBtn: HTMLButtonElement`; `Artwork.audio?: string`.

- [ ] **Step 1: Write the failing test**

Append to `tests/piece.test.ts`:

```ts
import { familyLabel } from '../src/piece';

describe('familyLabel', () => {
  it('prettifies known attractor families', () => {
    expect(familyLabel('lorenz')).toBe('Lorenz');
    expect(familyLabel('lorenz_84')).toBe('Lorenz-84');
    expect(familyLabel('chaotic_flow')).toBe('Chaotic flow');
    expect(familyLabel('polynomial_sprott')).toBe('Polynomial (Sprott)');
  });
  it('returns null for static-only, unknown, and missing systems', () => {
    expect(familyLabel('static-only')).toBeNull();
    expect(familyLabel('mystery_family')).toBeNull();
    expect(familyLabel(undefined)).toBeNull();
  });
});
```

(If `tests/piece.test.ts` already imports from `'../src/piece'`, merge `familyLabel` into that import line instead of adding a duplicate import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/piece.test.ts`
Expected: FAIL — `familyLabel` is not exported.

- [ ] **Step 3: Implement**

3a. In `src/data.ts`, extend `Artwork`:

```ts
export interface Artwork {
  day: number; title: string; slug: string;
  palette: string[]; brightness: number; x: number; y: number;
  audio?: string; // per-day sonified composition URL; absent everywhere until audio ships
}
```

3b. In `src/piece.ts`, add below `captionFor`:

```ts
// Quiet metadata line for the caption: the attractor family behind the day's piece. static-only
// (Incendia-era) days and anything unrecognized show nothing rather than a raw identifier.
const FAMILY_LABELS: Record<string, string> = {
  lorenz: 'Lorenz', lorenz_84: 'Lorenz-84', icon: 'Field–Golubitsky icon', pickover: 'Pickover',
  chaotic_flow: 'Chaotic flow', polynomial_a: 'Polynomial A', polynomial_b: 'Polynomial B',
  polynomial_c: 'Polynomial C', polynomial_func: 'Polynomial', polynomial_sprott: 'Polynomial (Sprott)',
};
export function familyLabel(system: string | undefined): string | null {
  if (!system) return null;
  return FAMILY_LABELS[system] ?? null;
}
```

3c. In `src/piece.ts`, update the constructor template: replace the two nav-button lines and the close-button line so the template reads:

```ts
    this.root.innerHTML = `
      <div class="piece-backdrop">
        <button class="piece-nav prev" aria-label="Previous day" title="Previous day">‹</button>
        <figure>
          <picture>
            <source type="image/avif" /><source type="image/webp" />
            <img alt="" />
          </picture>
          <figcaption></figcaption>
        </figure>
        <button class="piece-nav next" aria-label="Next day" title="Next day">›</button>
      </div>
      <button class="piece-close" aria-label="Return to the constellation" title="Return to the constellation"><span class="glyph">×</span> Sky</button>`;
```

(Only the `.piece-close` line changes; shown in full for placement.)

3d. Add fields to `PieceView`:

```ts
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private listenBtn: HTMLButtonElement;
  private audioEl = new Audio();
```

In the constructor, after `this.caption = this.root.querySelector('figcaption')!;` add:

```ts
    this.prevBtn = this.root.querySelector('.prev')!;
    this.nextBtn = this.root.querySelector('.next')!;
    this.listenBtn = document.createElement('button');
    this.listenBtn.className = 'piece-listen';
    this.listenBtn.addEventListener('click', () => {
      if (this.audioEl.paused) { this.audioEl.play(); this.listenBtn.textContent = '❚❚ Pause'; }
      else { this.audioEl.pause(); this.listenBtn.textContent = '▶ Listen'; }
    });
    this.audioEl.addEventListener('ended', () => { this.listenBtn.textContent = '▶ Listen'; });
```

3e. In `open()`, after `this.caption.textContent = captionFor(a);` add:

```ts
    // Destination-named arrows: the hover/focus label says where you'll land, not just "previous".
    const prevArt = this.byDay.get(neighborDay(a.day, -1))!;
    const nextArt = this.byDay.get(neighborDay(a.day, 1))!;
    this.prevBtn.dataset.label = `day ${String(prevArt.day).padStart(3, '0')}`;
    this.prevBtn.title = `day ${String(prevArt.day).padStart(3, '0')} · ${prevArt.title}`;
    this.prevBtn.setAttribute('aria-label', `Previous — day ${prevArt.day}: ${prevArt.title}`);
    this.nextBtn.dataset.label = `day ${String(nextArt.day).padStart(3, '0')}`;
    this.nextBtn.title = `day ${String(nextArt.day).padStart(3, '0')} · ${nextArt.title}`;
    this.nextBtn.setAttribute('aria-label', `Next — day ${nextArt.day}: ${nextArt.title}`);
    const fam = familyLabel(this.attractorsByDay.get(a.day)?.system);
    if (fam) {
      const meta = document.createElement('span');
      meta.className = 'caption-meta';
      meta.textContent = fam;
      this.caption.append(document.createElement('br'), meta);
    }
    this.audioEl.pause();
    if (a.audio) {
      this.audioEl.src = a.audio;
      this.listenBtn.textContent = '▶ Listen';
      this.caption.append(document.createElement('br'), this.listenBtn);
    }
```

3f. Rename the hide-image plumbing to the mode toggle. In `LiveDeps`, replace `hideImageBtn: HTMLButtonElement;` with `modeToggle: HTMLElement;`. In `open()`, replace `this.live_.hideImageBtn.style.display = this.liveAttractor ? 'block' : 'none';` with `this.live_.modeToggle.style.display = this.liveAttractor ? 'flex' : 'none';`. In `close()`, replace `this.live_.hideImageBtn.style.display = 'none';` with `this.live_.modeToggle.style.display = 'none';` and add `this.audioEl.pause();` as the first line of `close()`. In `nav()`, add `this.audioEl.pause();` before `this.onNavigate(next.slug);`.

3g. In `src/main.ts`, delete the `hideImageBtn` creation block, the `overlay.appendChild(hideImageBtn);` line, the `syncHideImageLabel` function + its call + its click listener. Add in their place:

```ts
  // Image | Orbit: the two modes of viewing a piece — the 2010 static render, or the live
  // re-simulated attractor cloud. Lit word = current mode. Shown only while a live-capable
  // piece is open (piece.open()/close() own its display).
  const modeToggle = document.createElement('div');
  modeToggle.id = 'mode-toggle';
  const imageBtn = document.createElement('button');
  imageBtn.textContent = 'Image';
  imageBtn.title = 'Show the 2010 static render';
  const orbitBtn = document.createElement('button');
  orbitBtn.textContent = 'Orbit';
  orbitBtn.title = 'Show only the live attractor';
  modeToggle.append(imageBtn, orbitBtn);
  const syncModeToggle = () => {
    const orbit = piece.isHidingStatic();
    imageBtn.classList.toggle('active', !orbit);
    orbitBtn.classList.toggle('active', orbit);
    imageBtn.setAttribute('aria-pressed', String(!orbit));
    orbitBtn.setAttribute('aria-pressed', String(orbit));
  };
  imageBtn.addEventListener('click', () => { if (piece.isHidingStatic()) { piece.toggleHideStatic(); syncModeToggle(); } });
  orbitBtn.addEventListener('click', () => { if (!piece.isHidingStatic()) { piece.toggleHideStatic(); syncModeToggle(); } });
```

Update the `PieceView` construction's live deps: `hideImageBtn` → `modeToggle`. Replace `overlay.appendChild(hideImageBtn);` (already deleted) with `overlay.appendChild(modeToggle);` in the same position (after `piece` construction, before `overlay.appendChild(brightnessSlider);`). Then replace the two `syncHideImageLabel();` calls (after construction and in the day-route handler) with `syncModeToggle();`.

- [ ] **Step 4: CSS**

In `src/style.css`:

Replace the `.piece-close` rule (keep the `.piece-nav, .piece-close` shared rule above it) with:

```css
.piece-close {
  position: absolute; top: 16px; right: 16px; z-index: 2;
  font-family: inherit; font-size: 14px; letter-spacing: 0.18em; padding: 12px;
  opacity: 1; transition: opacity 0.35s;
}
.piece-close .glyph { font-size: 18px; margin-right: 6px; vertical-align: -1px; }
```

Replace the `#hide-image-toggle` and `#hide-image-toggle[aria-pressed="true"]` rules with:

```css
#mode-toggle {
  position: absolute; bottom: 16px; right: 16px; display: none;
  border: 1px solid #333a48; border-radius: 16px; overflow: hidden; background: rgba(20,24,32,0.7);
}
#mode-toggle button {
  background: none; border: none; color: #9aa1b0; font: inherit; font-size: 13px;
  letter-spacing: 0.1em; padding: 6px 14px; cursor: pointer;
}
#mode-toggle button.active { background: #cfd3dc; color: #10131a; }
```

Append:

```css
.piece-nav { position: relative; }
.piece-nav::after {
  content: attr(data-label); position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  font-size: 11px; letter-spacing: 0.12em; color: #9aa1b0; white-space: nowrap;
  opacity: 0; transition: opacity 0.2s; pointer-events: none;
}
.piece-nav:hover::after, .piece-nav:focus-visible::after { opacity: 1; }
.caption-meta { color: #7f8797; font-size: 12px; letter-spacing: 0.1em; }
.piece-listen {
  background: none; border: 1px solid #333a48; border-radius: 14px; color: #cfd3dc;
  font: inherit; font-size: 12px; letter-spacing: 0.1em; padding: 4px 12px; margin-top: 8px; cursor: pointer;
}
.piece-listen:hover { color: #fff; border-color: #4a5268; }
```

- [ ] **Step 5: Run tests to verify they pass, then commit**

Run: `npx vitest run`
Expected: PASS including the new `familyLabel` describe.

```bash
git add src/data.ts src/piece.ts src/main.ts src/style.css tests/piece.test.ts
git commit -m "feat: piece-view actions — Sky, destination arrows, Image|Orbit, family line, Listen slot"
```

---

### Task 8: Pipeline — route shell pages, sitemap, day-page nav

**Files:**
- Create: `pipeline/routepages.mjs`
- Modify: `pipeline/sitemap.mjs` (full file, 9 lines)
- Modify: `pipeline/pages.mjs:36` (nav before `</div>`)
- Modify: `pipeline/build.mjs:51-57` (emit route pages), `:78-79` (sitemap count)
- Test: create `tests/routepages.test.mjs`; modify `tests/sitemap.test.mjs`, `tests/pages.test.mjs`

**Interfaces:**
- Consumes: `metaTags`, `SITE_TITLE`, `SITE_DESCRIPTION`, `CARD_IMAGE` from `pipeline/site.mjs` (unchanged).
- Produces: `ROUTE_PAGES` (array of `{path, title, description}`) and `renderRoutePage(entry): string`. `build.mjs` writes `public/attractors/index.html`, `public/sound/index.html`, `public/story/index.html` so the veil routes return real 200s regardless of the host's SPA-fallback behavior.

- [ ] **Step 1: Write the failing tests**

Create `tests/routepages.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderRoutePage, ROUTE_PAGES } from '../pipeline/routepages.mjs';

describe('ROUTE_PAGES', () => {
  it('covers the three veil destinations', () => {
    expect(ROUTE_PAGES.map(r => r.path)).toEqual(['/attractors/', '/sound/', '/story/']);
  });
});

describe('renderRoutePage', () => {
  const html = renderRoutePage(ROUTE_PAGES[0]);
  it('is a full app shell with canonical meta', () => {
    expect(html).toContain('<canvas id="gl">');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/attractors/" />');
    expect(html).toContain('/assets/app.js');
    expect(html).toContain('/assets/index.css');
  });
  it('carries the crawler nav', () => {
    for (const p of ['/today/', '/attractors/', '/sound/', '/story/']) {
      expect(html).toContain(`href="${p}"`);
    }
  });
});
```

In `tests/sitemap.test.mjs`, replace the first `it` with:

```js
  it('lists root, the three veil routes, and every day, absolute', () => {
    expect(xml).toContain('<loc>https://chaosofzen.dev/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/attractors/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/sound/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/story/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/001-rose/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/002-event-horizon/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(6);
  });
```

Append to `tests/pages.test.mjs` (using its existing `renderPiecePage` import — add the import if the file lacks it):

```js
describe('renderPiecePage crawler nav', () => {
  const html = renderPiecePage({ day: 1, title: 'Rose', slug: '001-rose' });
  it('links the four destinations', () => {
    for (const p of ['/today/', '/attractors/', '/sound/', '/story/']) {
      expect(html).toContain(`href="${p}"`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/routepages.test.mjs tests/sitemap.test.mjs tests/pages.test.mjs`
Expected: FAIL — no `routepages.mjs`; sitemap has 3 urls not 6; piece page has no nav links.

- [ ] **Step 3: Implement**

Create `pipeline/routepages.mjs`:

```js
import { metaTags, SITE_TITLE, SITE_DESCRIPTION, CARD_IMAGE } from './site.mjs';

// Static shells for the three veil destinations: real 200s with real metadata for crawlers and
// link previews, regardless of how the host handles unknown paths. The client app takes over on
// load exactly as it does on day pages (the .static-nav is removed at boot).
export const ROUTE_PAGES = [
  { path: '/attractors/', title: `Attractors — ${SITE_TITLE}`, description: 'Browse all 365 strange attractors, one for every day of 2010.' },
  { path: '/sound/', title: `Sound — ${SITE_TITLE}`, description: 'Music from the attractors — the Chaos of Zen discography and the sonification of all 365 days.' },
  { path: '/story/', title: `Story — ${SITE_TITLE}`, description: SITE_DESCRIPTION },
];

export const STATIC_NAV = `<nav class="static-nav">
<a href="/today/">Today</a>
<a href="/attractors/">Attractors</a>
<a href="/sound/">Sound</a>
<a href="/story/">Story</a>
</nav>`;

export function renderRoutePage({ path, title, description }) {
  const head = metaTags({ title, description, image: CARD_IMAGE, url: path, type: 'website' });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${head}
<link rel="stylesheet" href="/assets/index.css" />
</head>
<body>
<canvas id="gl"></canvas>
<div id="overlay">
${STATIC_NAV}
</div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
```

In `pipeline/sitemap.mjs`, replace the `urls` line with:

```js
  const urls = ['/', '/attractors/', '/sound/', '/story/', ...days.map(d => `/day/${d.slug}/`)];
```

In `pipeline/pages.mjs`: add `import { STATIC_NAV } from './routepages.mjs';` at the top, and in `renderPiecePage`'s template insert `${STATIC_NAV}` on its own line directly after `</figure>` (still inside `<div id="overlay">`).

In `pipeline/build.mjs`, directly after the day-pages loop's `console.log` (line 57), add:

```js
import { renderRoutePage, ROUTE_PAGES } from './routepages.mjs';
for (const rp of ROUTE_PAGES) {
  const dir = join(OUT, rp.path.replaceAll('/', ''));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderRoutePage(rp));
}
console.log(`route pages: ${ROUTE_PAGES.length} written`);
```

and update the final sitemap log to `` console.log(`sitemap.xml: ${days.length + 4} urls`); ``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/routepages.test.mjs tests/sitemap.test.mjs tests/pages.test.mjs`
Expected: PASS. (`tests/completeness.test.mjs` runs against real pipeline output and only fully greens after Task 9's pipeline run.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/routepages.mjs pipeline/sitemap.mjs pipeline/pages.mjs pipeline/build.mjs tests/routepages.test.mjs tests/sitemap.test.mjs tests/pages.test.mjs
git commit -m "feat: pipeline emits veil-route shells, sitemap and day pages gain the nav"
```

---

### Task 9: Full verification — suite, pipeline, live checklist

**Files:** none created; this is the gate.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all files pass except possibly `completeness.test.mjs` items gated on fresh pipeline output.

- [ ] **Step 2: Pipeline + build**

Run: `node pipeline/build.mjs` then `npm run build`
Expected: `route pages: 3 written`, `sitemap.xml: 369 urls`; Vite build clean. Re-run `npm test` — completeness now fully green.

- [ ] **Step 3: Live checklist (dev server, browser)**

Verify each, on desktop viewport and a ~375px mobile viewport:

- [ ] Arrival: whole-cloud frame → single eased flight onto today's sprite; sprite glows/pulses; caption fades in (correct day/date/title); hints line on first visit only.
- [ ] A drag or wheel mid-flight stops the flight instantly; caption dismisses on first interaction.
- [ ] DevTools "emulate prefers-reduced-motion": no flight — instant framing on today, caption visible.
- [ ] Deep link `/day/012-green-leafs/` does NOT settle on today; `/attractors/` opens the veil directly.
- [ ] Word-row reads Today · Attractors · Sound · Story, bottom center; hover glow; tooltips; middle-click opens a new tab.
- [ ] `/today/` and the Today word open today's piece; address bar shows the real `/day/NNN-slug/`.
- [ ] `/index/` and `/music/` land on the veils with the address bar rewritten to `/attractors/` / `/sound/` (no extra history entry — Back leaves the site).
- [ ] Attractors veil: constellation drifts visibly behind translucent blurred background; day cells middle-clickable; `/` focuses search; Escape returns home.
- [ ] Sound veil: discography renders; Sonification teaser section present; × Sky closes.
- [ ] Story veil: interim page renders; × Sky closes; `t` key works from home.
- [ ] Piece view: × Sky top-right; arrows show "day NNN" labels on hover; caption carries family line on a live day (e.g. day 008 "Lorenz") and no family line on a static-only day; Image|Orbit toggle switches modes with lit word correct; brightness slider only in Orbit; no Listen button anywhere (no audio data yet).
- [ ] Word-row/minimap/layout-switch/caption all hidden while any veil or piece is open; return home brings them back.
- [ ] Likeness|Date switch morphs the layout both ways; lit word tracks state.
- [ ] Static shells: `view-source:` on `/attractors/` shows the four nav links; a built day page shows them too.
- [ ] Console: no errors across all of the above.

- [ ] **Step 4: Commit any checklist fixes**

Each fix follows the house loop: reproduce → fix → re-verify → `git commit`.

---

## Self-Review Notes

- Spec coverage: §1 arrival → Tasks 2/3/6; §2 word-row + destinations → Tasks 1/4/5; §3 piece actions + scene controls → Tasks 5 (layout switch)/7; §4 architecture → file layout above; §5 testing → per-task TDD + Task 9; out-of-scope items untouched.
- The `t` keyboard shortcut is in Task 5's listener; the input-focus guard covers the veil search field.
- Task 5 leaves `syncHideImageLabel` temporarily referenced in the router (day handler) — it still exists until Task 7 renames it; the sequence compiles at every task boundary.
- Type consistency: `LiveDeps.modeToggle` (Task 7) matches `piece.open()/close()` usage; `Nav.setActive` takes `NavKind | null`; `Route` kinds match across router/nav/main.
- No placeholders: every step carries its full code.
