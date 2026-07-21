# Music/Video Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Music" section — a discography-style overlay linking out to Apple Music, YouTube, and Spotify for Chaos of Zen — reachable via a persistent corner button, following the site's existing router/overlay-view pattern.

**Architecture:** A new static `public/data/music.json` (no live API calls, refreshed manually like `artworks.json`), a new `MusicView` class following `PieceView`'s self-contained open/close/Escape/click-outside pattern, a new `{ kind: 'music' }` route, and a new "Music" nav button wired the same way as the existing Index/Time buttons in `main.ts`.

**Tech Stack:** Vite, TypeScript, Vitest (`npm test` = `vitest run`), no framework — direct DOM manipulation via `document.createElement`/`innerHTML` + `querySelector`, same as the rest of `src/`.

## Global Constraints

- No backend, no live API calls to Apple Music/YouTube/Spotify at runtime. `music.json` is a committed static file (spec §3).
- Cover art is hotlinked directly from Apple Music's own CDN URLs — no downloading, no image pipeline (spec §3).
- A `Release` with no matching YouTube number omits `youtubeUrl` entirely; the UI must show only platform links that actually exist, never a broken or guessed one (spec §4).
- Only the artist-level Spotify link is included — no per-release Spotify matching (spec §8, out of scope).
- No embedded playback (no audio previews, no YouTube iframe embeds) — link-out only (spec §8, out of scope).
- **Testing approach (human decision, overriding the spec's literal wording):** the spec's §7 asks for a DOM open/close test "mirroring the existing IndexView/PieceView test coverage." Checked against the actual test suite: no existing test instantiates a view class or touches the DOM — `router.test.ts`, `search.test.ts`, `piece.test.ts`, and `timeview.test.ts` all test pure functions extracted from their respective views (`parseRoute`, `searchArtworks`, `neighborDay`/`captionFor`, `spiralPosition`). There is no jsdom dependency and no Vitest environment override, so Vitest's default Node environment has no `document` global. The human chose to **match the real convention**: extract `MusicView`'s one piece of non-trivial logic (which platform links a release actually has) into a pure, unit-tested function, and verify the DOM/open-close wiring by manual browser click-through — consistent with the spec's own closing line in §7 ("manual browser verification... covers the rest"). Do not add jsdom.
- `music.json`'s catalog content must be the real, current Chaos of Zen catalog (spec §1 success criterion 2) — not placeholder or fabricated data. Task 3 below is written accordingly: it specifies the exact schema and the exact edge-case resolutions already made during brainstorming (spec §2), but the actual album/single/video titles, years, and URLs must come from browsing the four source pages listed there, not from this plan.

---

### Task 1: `/music/` route

**Files:**
- Modify: `src/router.ts:1-21`
- Test: `tests/router.test.ts`

**Interfaces:**
- Produces: `Route` union gains `{ kind: 'music' }`. `parseRoute('/music/')` → `{ kind: 'music' }`. `routePath({ kind: 'music' })` → `'/music/'`. Later tasks (`main.ts`) call `router.go({ kind: 'music' })` and check `r.kind === 'music'` in the router's `onChange` callback.

- [ ] **Step 1: Write the failing test**

Add to `tests/router.test.ts`, inside the existing `describe('parseRoute', ...)` block's `it('parses all route kinds', ...)` test:

```ts
    expect(parseRoute('/music/')).toEqual({ kind: 'music' });
```

And extend the round-trip test in the same file:

```ts
    expect(parseRoute(routePath({ kind: 'music' }))).toEqual({ kind: 'music' });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL — `expect(received).toEqual(expected)`, received `{ kind: 'home' }` (the `/music/` path doesn't match any existing branch yet).

- [ ] **Step 3: Implement**

In `src/router.ts`, change the `Route` type (line 1-3):

```ts
export type Route =
  | { kind: 'home' } | { kind: 'day'; slug: string }
  | { kind: 'index' } | { kind: 'about' } | { kind: 'music' };
```

Add a branch in `parseRoute` (after the `/index` check, line 9):

```ts
  if (p === '/index') return { kind: 'index' };
  if (p === '/about') return { kind: 'about' };
  if (p === '/music') return { kind: 'music' };
  return { kind: 'home' };
```

Add a case in `routePath` (after `'about'`, line 19):

```ts
    case 'about': return '/about/';
    case 'music': return '/music/';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/router.ts tests/router.test.ts
git commit -m "feat: add /music/ route"
```

---

### Task 2: `musicdata.ts` — types, loader, and `platformLinks`

**Files:**
- Create: `src/musicdata.ts`
- Test: `tests/musicdata.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Task 1; can be done in either order).
- Produces:
  - `interface MusicData { artist: Artist; albums: Album[]; musicVideos: Release[]; singles: Release[] }`
  - `interface Artist { name: string; bio: string; appleMusicUrl: string; youtubeUrl: string; spotifyUrl: string }`
  - `interface Album { title: string; year: number; trackCount: number; artworkUrl: string; appleMusicUrl: string }`
  - `interface Release { title: string; type: 'single' | 'ep' | 'video'; year: number; artworkUrl: string; appleMusicUrl: string; youtubeUrl?: string }`
  - `function loadMusicData(): Promise<MusicData>` — fetches `/data/music.json`, following the exact pattern of `loadData()`/`loadAttractors()` in `src/data.ts`.
  - `function platformLinks(release: Release): { label: string; url: string }[]` — the one piece of non-trivial logic this file has: always includes an Apple Music link, includes a YouTube link only when `release.youtubeUrl` is present. This is what `MusicView` (Task 4) calls to decide which link buttons to render per release; it is the pure function this codebase's convention says should carry the unit test coverage instead of a DOM test (see Global Constraints).

- [ ] **Step 1: Write the failing test**

Create `tests/musicdata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { platformLinks } from '../src/musicdata';
import type { Release } from '../src/musicdata';

const release = (overrides: Partial<Release> = {}): Release => ({
  title: '52.14', type: 'single', year: 2026,
  artworkUrl: 'https://example.com/art.jpg',
  appleMusicUrl: 'https://music.apple.com/us/song/example/1',
  ...overrides,
});

describe('platformLinks', () => {
  it('always includes Apple Music', () => {
    const links = platformLinks(release());
    expect(links).toContainEqual({ label: 'Apple Music', url: 'https://music.apple.com/us/song/example/1' });
  });
  it('omits YouTube when the release has no youtubeUrl', () => {
    const links = platformLinks(release());
    expect(links).toHaveLength(1);
    expect(links.some(l => l.label === 'YouTube')).toBe(false);
  });
  it('includes YouTube when the release has a matched youtubeUrl', () => {
    const links = platformLinks(release({ youtubeUrl: 'https://youtube.com/watch?v=abc123' }));
    expect(links).toContainEqual({ label: 'YouTube', url: 'https://youtube.com/watch?v=abc123' });
    expect(links).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/musicdata.test.ts`
Expected: FAIL — `src/musicdata.ts` does not exist ("Failed to resolve import").

- [ ] **Step 3: Implement**

Create `src/musicdata.ts`:

```ts
export interface Artist {
  name: string;
  bio: string;
  appleMusicUrl: string;
  youtubeUrl: string;
  spotifyUrl: string;
}

export interface Album {
  title: string;
  year: number;
  trackCount: number;
  artworkUrl: string;
  appleMusicUrl: string;
}

export interface Release {
  title: string;
  type: 'single' | 'ep' | 'video';
  year: number;
  artworkUrl: string;
  appleMusicUrl: string;
  youtubeUrl?: string;
}

export interface MusicData {
  artist: Artist;
  albums: Album[];
  musicVideos: Release[];
  singles: Release[];
}

export async function loadMusicData(): Promise<MusicData> {
  return fetch('/data/music.json').then(r => r.json());
}

export function platformLinks(release: Release): { label: string; url: string }[] {
  const links = [{ label: 'Apple Music', url: release.appleMusicUrl }];
  if (release.youtubeUrl) links.push({ label: 'YouTube', url: release.youtubeUrl });
  return links;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/musicdata.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/musicdata.ts tests/musicdata.test.ts
git commit -m "feat: add music data types, loader, and platformLinks helper"
```

---

### Task 3: `music.json` — real catalog data + completeness test

**This task is different in character from the others.** Its content cannot be written into this plan as literal JSON, because the full catalog has not been scraped yet — the spec (§2) explicitly says Apple's page previews only 7 singles (52.14–52.20) while referencing numbers up to at least 52.51 elsewhere, so "the true list is longer and must be scraped in full." Writing fabricated album titles or URLs into this plan would violate the spec's own success criterion that the content be real, current, and not placeholder (spec §1). This task's job is to go get that real data, following the exact schema from Task 2 and the exact edge-case resolutions already made during brainstorming (spec §2, reproduced verbatim below) — then validate its shape with a completeness test, which *can* be written exactly, since its assertions are structural.

**Files:**
- Create: `public/data/music.json`
- Test: `tests/music-completeness.test.mjs`

**Interfaces:**
- Consumes: the `MusicData`/`Album`/`Release` shape from Task 2 (`src/musicdata.ts`) — the JSON's structure must match those interfaces exactly, since Task 4's `MusicView` will `JSON.parse` it into those types with no runtime validation beyond what this task's test provides.
- Produces: `public/data/music.json`, the file `loadMusicData()` (Task 2) fetches and `MusicView` (Task 4) renders.

- [ ] **Step 1: Gather the real catalog data**

Using a browser, visit each source and record what it contains, following the exact schema from Task 2:

| Source | URL | What to record |
|---|---|---|
| Apple Music artist page | `https://music.apple.com/us/artist/chaos-of-zen/424257434` | Every album (title, year, track count, artwork URL, Apple Music URL), every item under "Music Videos" and "Singles & EPs" (title, year, artwork URL, Apple Music URL), and the bio Q&A text |
| YouTube playlist "52" | `https://youtube.com/playlist?list=PLXZ06Hw0ql3qQMu3zh4naw_vwFt28wNPa` | Every video's URL, matched by number (e.g. "52.14") to the corresponding Apple Music single/video |
| YouTube channel | `https://youtube.com/@chaosofzen` | The channel URL, for `artist.youtubeUrl` |
| Spotify artist page | `https://open.spotify.com/artist/2kyJGKFwjut7J2itBQkwwa` | The artist URL, for `artist.spotifyUrl` |

Apply these edge-case resolutions exactly as already decided during brainstorming (spec §2) — do not re-litigate them:

- Exclude "J****o Protagonista (feat. Joe Chavez)" from "En la Cigarra · 2013" — unrelated artist matched by name coincidence, not part of the Chaos of Zen catalog.
- The video at playlist position 14 is untitled on YouTube ("Track 14 of 52") — treat it as 52.14's video by playlist position, not by title match.
- "52.15" exists as both a plain version and a "52.15 Square" version (same length) — use the plain version's URL.
- "52.49 NASA's James Webb Space Telescope #UnfoldTheUniverse Art Challenge" shares a number with 52.49 by coincidence but is a one-off bonus video, not part of the core numbered series — exclude it; 52.49 (if it exists as a numbered single/EP) gets no `youtubeUrl`.

Adapt the Apple Music bio Q&A into 2-3 short prose paragraphs for `artist.bio` (spec §5 layout item 1: earliest musical memory, favorite albums, the "Eight-02.26" piece) — not a literal question-and-answer transcript.

- [ ] **Step 2: Write `public/data/music.json`**

Populate the file matching this exact structure (values below are illustrative placeholders for the *shape* only — replace every value with what Step 1 actually found):

```json
{
  "artist": {
    "name": "Chaos of Zen",
    "bio": "…",
    "appleMusicUrl": "https://music.apple.com/us/artist/chaos-of-zen/424257434",
    "youtubeUrl": "https://youtube.com/@chaosofzen",
    "spotifyUrl": "https://open.spotify.com/artist/2kyJGKFwjut7J2itBQkwwa"
  },
  "albums": [
    { "title": "Random Acts of Ambients, Vol. 1", "year": 2011, "trackCount": 0, "artworkUrl": "…", "appleMusicUrl": "…" },
    { "title": "Random Acts of Ambients, Vol. 2", "year": 2019, "trackCount": 0, "artworkUrl": "…", "appleMusicUrl": "…" }
  ],
  "musicVideos": [
    { "title": "52.06", "type": "video", "year": 2022, "artworkUrl": "…", "appleMusicUrl": "…", "youtubeUrl": "…" }
  ],
  "singles": [
    { "title": "52.14", "type": "single", "year": 2026, "artworkUrl": "…", "appleMusicUrl": "…", "youtubeUrl": "…" }
  ]
}
```

`trackCount: 0` above is a placeholder needing the real per-album track count from Apple Music — do not leave it as 0 in the committed file. `musicVideos` must end up with exactly 6 entries (52.32, 52.52, 52.06, 52.07, 52.39, 52.46, per spec §2) and `singles` must include every numbered single/EP found in Step 1, not just the 7 Apple's page previews by default.

- [ ] **Step 3: Write the completeness test**

Create `tests/music-completeness.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const DATA = 'public/data/music.json';
const URL_RE = /^https:\/\//;

describe.skipIf(!existsSync(DATA))('music.json completeness', () => {
  const music = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : null;

  it('has an artist with all required fields and well-formed URLs', () => {
    const { artist } = music;
    expect(artist.name).toBe('Chaos of Zen');
    expect(typeof artist.bio).toBe('string');
    expect(artist.bio.length).toBeGreaterThan(0);
    for (const key of ['appleMusicUrl', 'youtubeUrl', 'spotifyUrl']) {
      expect(artist[key], key).toMatch(URL_RE);
    }
  });

  it('has exactly 2 albums, each with required fields and well-formed URLs', () => {
    expect(music.albums).toHaveLength(2);
    for (const a of music.albums) {
      expect(typeof a.title).toBe('string');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.year).toBeGreaterThan(2000);
      expect(a.trackCount).toBeGreaterThan(0);
      expect(a.artworkUrl).toMatch(URL_RE);
      expect(a.appleMusicUrl).toMatch(URL_RE);
    }
  });

  it('has exactly 6 music videos, all number-matched to a YouTube URL', () => {
    expect(music.musicVideos).toHaveLength(6);
    for (const r of music.musicVideos) {
      expect(r.type).toBe('video');
      expect(r.artworkUrl).toMatch(URL_RE);
      expect(r.appleMusicUrl).toMatch(URL_RE);
      expect(r.youtubeUrl, `${r.title} should have a matched YouTube URL`).toMatch(URL_RE);
    }
  });

  it('has more than the 7-item preview count of singles/EPs, each well-formed', () => {
    expect(music.singles.length).toBeGreaterThan(7);
    for (const r of music.singles) {
      expect(['single', 'ep']).toContain(r.type);
      expect(r.year).toBeGreaterThan(2000);
      expect(r.artworkUrl).toMatch(URL_RE);
      expect(r.appleMusicUrl).toMatch(URL_RE);
      if (r.youtubeUrl !== undefined) expect(r.youtubeUrl).toMatch(URL_RE);
    }
  });

  it('has no duplicate titles within musicVideos or within singles', () => {
    expect(new Set(music.musicVideos.map(r => r.title)).size).toBe(music.musicVideos.length);
    expect(new Set(music.singles.map(r => r.title)).size).toBe(music.singles.length);
  });

  it('does not include the unrelated "En la Cigarra" track', () => {
    const all = [...music.musicVideos, ...music.singles];
    expect(all.some(r => r.title.includes('Protagonista'))).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes against the real data**

Run: `npx vitest run tests/music-completeness.test.mjs`
Expected: PASS, all assertions green. If any assertion fails, the data from Step 2 is incomplete or malformed — fix `music.json`, not the test.

- [ ] **Step 5: Commit**

```bash
git add public/data/music.json tests/music-completeness.test.mjs
git commit -m "feat: add Chaos of Zen catalog data + completeness test"
```

---

### Task 4: `MusicView` class

**Files:**
- Create: `src/musicview.ts`

**Interfaces:**
- Consumes: `MusicData`, `Release`, `platformLinks` from `src/musicdata.ts` (Task 2).
- Produces: `class MusicView { constructor(overlay: HTMLElement, data: MusicData, onClose: () => void); open(): void; close(): void; isOpen(): boolean }` — the exact same three-method shape as `IndexView` and `PieceView`, so Task 5 wires it into `main.ts`'s router callback identically to those.

No automated test for this task — see Global Constraints. Verification is manual (Step 4 below).

- [ ] **Step 1: Implement `MusicView`**

Create `src/musicview.ts`, following `PieceView`'s self-contained close-handling pattern (×/click-outside/Escape all bound inside the class) and `IndexView`'s `open()`/`close()`/`isOpen()` state shape:

```ts
import type { MusicData, Release } from './musicdata';
import { platformLinks } from './musicdata';

export class MusicView {
  private root: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private data: MusicData, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'musicview hidden';
    this.root.innerHTML = `
      <button class="music-close" aria-label="Close" title="Close">×</button>
      <div class="music-header">
        <h1></h1>
        <p class="music-bio"></p>
        <div class="music-artist-links"></div>
      </div>
      <section class="music-albums"><h2>Albums</h2><div class="music-album-grid"></div></section>
      <section class="music-videos"><h2>Music Videos</h2><div class="music-thumb-grid"></div></section>
      <section class="music-singles"><h2>Singles &amp; EPs</h2><div class="music-thumb-grid"></div></section>`;
    overlay.appendChild(this.root);

    this.root.querySelector('h1')!.textContent = data.artist.name;
    this.root.querySelector('.music-bio')!.textContent = data.artist.bio;
    const artistLinks = this.root.querySelector('.music-artist-links')!;
    for (const [label, url] of [
      ['Apple Music', data.artist.appleMusicUrl],
      ['YouTube', data.artist.youtubeUrl],
      ['Spotify', data.artist.spotifyUrl],
    ] as const) {
      artistLinks.appendChild(this.linkButton(label, url));
    }

    const albumGrid = this.root.querySelector('.music-albums .music-album-grid')!;
    for (const a of data.albums) {
      const card = document.createElement('a');
      card.className = 'music-album-card';
      card.href = a.appleMusicUrl;
      card.target = '_blank';
      card.rel = 'noopener';
      card.innerHTML = `<img loading="lazy" src="${a.artworkUrl}" alt="${a.title}" />
        <span class="music-album-title">${a.title}</span>
        <span class="music-album-meta">${a.year} · ${a.trackCount} tracks</span>`;
      albumGrid.appendChild(card);
    }

    const videoGrid = this.root.querySelector('.music-videos .music-thumb-grid')!;
    for (const r of data.musicVideos) videoGrid.appendChild(this.thumb(r));

    const singleGrid = this.root.querySelector('.music-singles .music-thumb-grid')!;
    for (const r of data.singles) singleGrid.appendChild(this.thumb(r));

    this.root.querySelector('.music-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.requestClose();
    });
  }

  private linkButton(label: string, url: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = 'music-link-btn';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    return a;
  }

  private thumb(release: Release): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'music-thumb';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = release.artworkUrl;
    img.alt = release.title;
    const title = document.createElement('span');
    title.className = 'music-thumb-title';
    title.textContent = `${release.title} · ${release.year}`;
    const links = document.createElement('div');
    links.className = 'music-thumb-links';
    for (const { label, url } of platformLinks(release)) links.appendChild(this.linkButton(label, url));
    cell.append(img, title, links);
    return cell;
  }

  private requestClose(): void { this.close(); this.onClose(); }

  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all existing tests still pass — this task added no test file, so the count should match Task 3's final count exactly.

- [ ] **Step 4: Manual verification (this task's actual verification, per the Global Constraints testing decision)**

```bash
npm run dev
```

In the browser:
- Manually navigate to `http://localhost:5173/music/` — nothing renders it yet (Task 5 wires the route); confirm no console errors from `musicview.ts` itself by checking the browser console for import/syntax errors.
- This step's real confirmation happens in Task 5, once the view is actually reachable — this step exists to catch `MusicView`-internal errors (a bad selector, a typo in `innerHTML`) before wiring it in, isolating which task a bug belongs to.

- [ ] **Step 5: Commit**

```bash
git add src/musicview.ts
git commit -m "feat: add MusicView"
```

---

### Task 5: Wire `MusicView` into `main.ts` + styling

**Files:**
- Modify: `src/main.ts:1-13` (imports), `src/main.ts:12-13` (boot's initial data load), `src/main.ts:100-127` (nav buttons + router callback)
- Modify: `src/style.css` (append new rules)

**Interfaces:**
- Consumes: `MusicView` (Task 4), `{ kind: 'music' }` route (Task 1), `loadMusicData` (Task 2).

- [ ] **Step 1: Load music data alongside the existing boot-time data**

In `src/main.ts`, add the import (near the top, alongside the other view imports):

```ts
import { MusicView } from './musicview';
import { loadMusicData } from './musicdata';
```

Change the boot-time data load (`src/main.ts:13`):

```ts
  const [{ artworks, atlas }, attractors, musicData] = await Promise.all([loadData(), loadAttractors(), loadMusicData()]);
```

- [ ] **Step 2: Instantiate `MusicView` and its nav button**

After the existing `IndexView`/`indexBtn` block (`src/main.ts:100-109`), add:

```ts
  const music = new MusicView(overlay, musicData, () => router.go({ kind: 'home' }));
  const musicBtn = document.createElement('button');
  musicBtn.id = 'music-toggle';
  musicBtn.textContent = 'Music';
  musicBtn.title = 'Chaos of Zen discography';
  overlay.appendChild(musicBtn);
  musicBtn.addEventListener('click', () => router.go({ kind: 'music' }));
```

- [ ] **Step 3: Handle the `music` route in the router callback**

Modify the `Router` callback (`src/main.ts:115-127`) to add music handling. The existing callback:

```ts
  const router = new Router(async r => {
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

becomes:

```ts
  const router = new Router(async r => {
    if (r.kind === 'music') { piece.close(); index.close(); music.open(); return; }
    music.close();
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

`music.close()` runs unconditionally on every non-music route, mirroring how `index.close()` already runs unconditionally on every non-index route — so navigating away from `/music/` to anywhere else always closes it, the same guarantee the existing views have.

- [ ] **Step 4: Add styling**

Append to `src/style.css` (distinct dark discography layout, not styled to match the constellation's sprite aesthetic — reusing the site's existing overlay chrome conventions: `#overlay > .foo.hidden { opacity: 0; pointer-events: none; }` and the `#cfd3dc` text color already used by `.indexview`):

```css
#overlay > .musicview.hidden { opacity: 0; pointer-events: none; }
.musicview {
  position: absolute; inset: 0; overflow-y: auto;
  background: #12141a; color: #cfd3dc;
  padding: 48px 24px; box-sizing: border-box;
}
.music-close {
  position: fixed; top: 16px; right: 16px; z-index: 1;
  font-size: 28px; line-height: 1; background: none; border: none; color: #cfd3dc; cursor: pointer;
}
.music-header { max-width: 640px; margin: 0 auto 40px; text-align: center; }
.music-header h1 { font-weight: normal; letter-spacing: 0.08em; }
.music-bio { line-height: 1.6; opacity: 0.85; }
.music-artist-links { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }
.music-link-btn {
  color: #cfd3dc; border: 1px solid #444; border-radius: 4px; padding: 6px 14px;
  text-decoration: none; font-size: 13px;
}
.music-albums, .music-videos, .music-singles { max-width: 960px; margin: 0 auto 40px; }
.music-albums h2, .music-videos h2, .music-singles h2 {
  font-weight: normal; letter-spacing: 0.12em; font-size: 15px; margin: 0 0 16px;
}
.music-album-grid { display: flex; gap: 24px; flex-wrap: wrap; }
.music-album-card {
  color: inherit; text-decoration: none; width: 200px; display: flex; flex-direction: column; gap: 6px;
}
.music-album-card img { width: 200px; height: 200px; object-fit: cover; }
.music-thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
.music-thumb { display: flex; flex-direction: column; gap: 4px; }
.music-thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.music-thumb-title { font-size: 12px; }
.music-thumb-links { display: flex; gap: 6px; }
.music-thumb-links .music-link-btn { padding: 2px 8px; font-size: 11px; }
```

- [ ] **Step 5: Type-check and run the full suite**

```bash
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass (no new automated tests in this task — it's wiring + CSS).

- [ ] **Step 6: Manual verification — the actual test for this task and Task 4 together**

```bash
npm run dev
```

Walk through, in the browser:
1. Click the "Music" button — the overlay opens showing header/bio/artist links, 2 album cards, a 6-item video grid, and a scrollable singles grid.
2. Every album card and thumbnail's Apple Music link opens the correct Apple Music page in a new tab.
3. Every music video thumbnail has a YouTube link (all 6 should, per spec — confirmed by Task 3's completeness test).
4. Click the × button — the view closes.
5. Reopen via the Music button, press **Escape** — the view closes.
6. Reopen, click the dark background outside the content (not on a card/link) — the view closes.
7. Navigate directly to `http://localhost:5173/music/` — the view opens on load (deep link).
8. With Music open, click browser **back** — the view closes and the underlying constellation is visible again; click **forward** — it reopens.
9. Open Music, then click the "Index" button — Music closes, Index opens (confirms `music.close()` fires on route change away from music, and vice versa: open Index, click Music, confirm Index closes).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat: wire MusicView into navigation and routing"
```

---

## Self-Review Notes

**Spec coverage:** §1 (purpose/success criteria) → Tasks 3-5. §2 (source material, edge cases) → Task 3 Step 1. §3 (architecture) → Tasks 1, 2, 4 (no backend/live calls: `music.json` is static; `MusicView` follows the overlay pattern; router gets a new kind; hotlinked artwork — no image pipeline touched). §4 (data model) → Task 2. §5 (layout) → Task 4 Step 1 (structure) + Task 5 Step 4 (styling). §6 (error handling) → covered by: broken artwork uses ordinary `<img>` fallback (no special handling written, matching "browser's normal broken-image behavior is acceptable"); missing `youtubeUrl` handled by `platformLinks` (Task 2); a `music.json` fetch/parse failure is not special-cased in `loadMusicData` — matching the spec's "shows nothing rather than crashing the rest of the app," since an unhandled rejection in the `Promise.all` at boot would reject that promise without touching the already-independent `Constellation`/`Controls` setup that runs after it. §7 (testing) → Tasks 2 (unit test), 3 (completeness test), 4/5 (manual, per the human's explicit override — see Global Constraints). §8 (out of scope) → respected by omission: no embedded playback code written, no image-pipeline integration, no per-release Spotify field in the `Release` type, no live-sync mechanism.

**Placeholder scan:** Task 3 Step 2's JSON contains `"…"` and `0` values — these are flagged explicitly in that step's own text as needing replacement with real scraped data, not left silent; this is the one deliberate, called-out exception to "no placeholders," required because live catalog data cannot be fabricated into a plan document (see Task 3's header note and Global Constraints).

**Type consistency:** `Release`/`Album`/`Artist`/`MusicData` are defined once in Task 2 and referenced identically (same field names, same optionality on `youtubeUrl`) in Task 3's JSON shape, Task 3's completeness test, and Task 4's `MusicView`. `platformLinks(release: Release)` is defined in Task 2 and imported by name, unchanged, in Task 4. `MusicView`'s constructor signature (`overlay, data, onClose`) and its `open()`/`close()`/`isOpen()` methods match the shape Task 5 calls exactly.
