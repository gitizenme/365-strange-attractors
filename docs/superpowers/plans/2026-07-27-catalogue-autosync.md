# Catalogue Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually-triggered GitHub Action that reconciles the Apple Music + YouTube catalogue against `public/data/music.json` and opens a PR with additive-only changes.

**Architecture:** One Node script (`scripts/sync-catalogue.mjs`) with pure, unit-tested core functions plus a thin I/O `main()`, and one `workflow_dispatch` workflow that runs it and opens a PR via the `gh` CLI. Data is fetched from the official Apple Music API (ES256 JWT signed at runtime with `node:crypto`) and the YouTube Data API (API key). The merge is strictly additive, keyed by Apple catalogue ID.

**Tech Stack:** Node 20+ (native `fetch`), `node:crypto` for JWT, vitest, GitHub Actions, `gh` CLI.

## Global Constraints

- Node 20+ only; use native `fetch` and `node:crypto`. **No new npm dependencies.**
- All new source is ESM `.mjs`, matching `pipeline/*.mjs` and `scripts/*`.
- `public/data/music.json` is a **tracked file inside a gitignored dir** (`.gitignore` has `public/data/`); always stage it with `git add -f`.
- Write `music.json` as `JSON.stringify(obj, null, 2) + "\n"` (2-space indent, trailing newline, non-ASCII unescaped) to match the existing file and keep diffs minimal.
- The sync is **additive and non-destructive**: never edit, reorder, or delete existing entries; report disappeared items, don't remove them.
- Apple artist id `424257434`; YouTube uploads playlist `UU36M5xtxSc9S2bw4NgSM_zA`; storefront `us`.
- `music.json` shape: `{ artist, albums[], musicVideos[], singles[] }`. `Release` = `{ title, type:'single'|'ep'|'video', year, artworkUrl, appleMusicUrl, youtubeUrl? }`. `Album` = `{ title, year, trackCount, artworkUrl, appleMusicUrl }`.

---

### Task 1: Apple developer token (ES256 JWT)

**Files:**
- Create: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Produces: `buildDeveloperToken({ teamId, keyId, privateKey, now }) -> string` — a signed ES256 JWT. `privateKey` is a PKCS#8 PEM string (the `.p8` contents). `now` is epoch ms (default `Date.now()`).

- [ ] **Step 1: Write the failing test**

```js
// tests/sync-catalogue.test.mjs
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildDeveloperToken } from '../scripts/sync-catalogue.mjs';

const b64urlToJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

describe('buildDeveloperToken', () => {
  it('builds an ES256 JWT with the right header/claims and a valid signature', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const token = buildDeveloperToken({ teamId: 'TEAM123', keyId: 'KEY456', privateKey: pem, now: 1_700_000_000_000 });

    const [h, p, sig] = token.split('.');
    expect(b64urlToJson(h)).toEqual({ alg: 'ES256', kid: 'KEY456', typ: 'JWT' });
    expect(b64urlToJson(p)).toEqual({ iss: 'TEAM123', iat: 1_700_000_000, exp: 1_700_000_000 + 1200 });

    const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — `buildDeveloperToken` is not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/sync-catalogue.mjs
import crypto from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

export function buildDeveloperToken({ teamId, keyId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: teamId, iat, exp: iat + 1200 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput),
    { key: crypto.createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): Apple developer token (ES256 JWT) builder"
```

---

### Task 2: Pure extractors

**Files:**
- Modify: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Produces:
  - `extractAppleId(url) -> string | null` — trailing numeric id of an Apple Music URL.
  - `videoNumber(title) -> string | null` — the `"52.NN"` token in a title, or null.
  - `fillArtwork(template, size = 1200) -> string` — replaces `{w}`/`{h}` in an Apple `artwork.url`.
  - `youtubeMapByNumber(items) -> Record<string,string>` — maps `"52.NN"` → `https://youtube.com/watch?v=<id>` from YouTube `playlistItems` `items`. On duplicate numbers, keeps the shortest title.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/sync-catalogue.test.mjs
import { extractAppleId, videoNumber, fillArtwork, youtubeMapByNumber } from '../scripts/sync-catalogue.mjs';

describe('extractAppleId', () => {
  it('pulls the trailing id from video and album URLs', () => {
    expect(extractAppleId('https://music.apple.com/us/music-video/52-01/1634272910')).toBe('1634272910');
    expect(extractAppleId('https://music.apple.com/us/album/x/921794668')).toBe('921794668');
    expect(extractAppleId('nonsense')).toBe(null);
  });
});

describe('videoNumber', () => {
  it('extracts the 52.NN token, ignoring suffixes', () => {
    expect(videoNumber('52.01')).toBe('52.01');
    expect(videoNumber('52.15 Visualizer Video')).toBe('52.15');
    expect(videoNumber('Chaos of Zen - 52.23')).toBe('52.23');
    expect(videoNumber('no number')).toBe(null);
  });
});

describe('fillArtwork', () => {
  it('fills the {w}x{h} template to 1200x1200', () => {
    expect(fillArtwork('https://x/{w}x{h}bb.jpg')).toBe('https://x/1200x1200bb.jpg');
  });
});

describe('youtubeMapByNumber', () => {
  it('maps 52.NN to a watch URL, preferring the shortest title on dupes', () => {
    const items = [
      { snippet: { title: 'Chaos of Zen - 52.01', resourceId: { videoId: 'AAA' } } },
      { snippet: { title: 'Chaos of Zen - 52.15 Square', resourceId: { videoId: 'BBB' } } },
      { snippet: { title: 'Chaos of Zen - 52.15', resourceId: { videoId: 'CCC' } } },
    ];
    const map = youtubeMapByNumber(items);
    expect(map['52.01']).toBe('https://youtube.com/watch?v=AAA');
    expect(map['52.15']).toBe('https://youtube.com/watch?v=CCC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — extractors not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/sync-catalogue.mjs
export function extractAppleId(url) {
  const m = /\/(\d+)(?:[/?#]|$)/.exec(String(url || ''));
  return m ? m[1] : null;
}

export function videoNumber(title) {
  const m = /52\.(\d{2})/.exec(String(title || ''));
  return m ? `52.${m[1]}` : null;
}

export function fillArtwork(template, size = 1200) {
  return String(template || '').replace('{w}', String(size)).replace('{h}', String(size));
}

export function youtubeMapByNumber(items) {
  const byNum = {};
  const titleFor = {};
  for (const it of items || []) {
    const title = it?.snippet?.title || '';
    const id = it?.snippet?.resourceId?.videoId || it?.contentDetails?.videoId;
    const n = videoNumber(title);
    if (!n || !id) continue;
    if (!(n in byNum) || title.length < titleFor[n].length) {
      byNum[n] = `https://youtube.com/watch?v=${id}`;
      titleFor[n] = title;
    }
  }
  return byNum;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): pure extractors for id, number, artwork, youtube map"
```

---

### Task 3: Entry builders

**Files:**
- Modify: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Consumes: `fillArtwork`, `videoNumber` (Task 2).
- Produces:
  - `buildVideoEntry(appleVideo, youtubeMap) -> Release` — keys in order `title, type:'video', year, artworkUrl, appleMusicUrl` then `youtubeUrl` only if the number is in `youtubeMap`.
  - `buildAlbumEntry(appleAlbum) -> Album` — keys `title, year, trackCount, artworkUrl, appleMusicUrl`.
  - `buildSingleEntry(appleAlbum) -> Release` — keys `title, type:'single', year, artworkUrl, appleMusicUrl` (no youtubeUrl).
  - Apple item shape: `{ attributes: { name, url, artwork: { url }, releaseDate, trackCount } }`.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/sync-catalogue.test.mjs
import { buildVideoEntry, buildAlbumEntry, buildSingleEntry } from '../scripts/sync-catalogue.mjs';

const appleVideo = { attributes: {
  name: '52.29', url: 'https://music.apple.com/us/music-video/52-29/1634973753',
  artwork: { url: 'https://x/{w}x{h}bb.jpg' }, releaseDate: '2021-05-14' } };

describe('buildVideoEntry', () => {
  it('maps Apple fields and attaches youtube when matched', () => {
    expect(buildVideoEntry(appleVideo, { '52.29': 'https://youtube.com/watch?v=IFHfhA0lKb4' })).toEqual({
      title: '52.29', type: 'video', year: 2021,
      artworkUrl: 'https://x/1200x1200bb.jpg',
      appleMusicUrl: 'https://music.apple.com/us/music-video/52-29/1634973753',
      youtubeUrl: 'https://youtube.com/watch?v=IFHfhA0lKb4',
    });
  });
  it('omits youtubeUrl when there is no match', () => {
    const e = buildVideoEntry(appleVideo, {});
    expect('youtubeUrl' in e).toBe(false);
  });
});

describe('buildAlbumEntry / buildSingleEntry', () => {
  const appleAlbum = { attributes: {
    name: 'Random Acts of Ambients Vol. 1',
    url: 'https://music.apple.com/us/album/x/921794668',
    artwork: { url: 'https://y/{w}x{h}bb.jpg' }, releaseDate: '2014', trackCount: 10 } };
  it('builds album with trackCount', () => {
    expect(buildAlbumEntry(appleAlbum)).toEqual({
      title: 'Random Acts of Ambients Vol. 1', year: 2014, trackCount: 10,
      artworkUrl: 'https://y/1200x1200bb.jpg',
      appleMusicUrl: 'https://music.apple.com/us/album/x/921794668',
    });
  });
  it('builds single with type single and no trackCount', () => {
    const s = buildSingleEntry(appleAlbum);
    expect(s.type).toBe('single');
    expect('trackCount' in s).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/sync-catalogue.mjs
const yearOf = (releaseDate) => Number(String(releaseDate || '').slice(0, 4)) || null;

export function buildVideoEntry(appleVideo, youtubeMap) {
  const a = appleVideo.attributes;
  const entry = {
    title: a.name, type: 'video', year: yearOf(a.releaseDate),
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
  const yt = youtubeMap[videoNumber(a.name)];
  if (yt) entry.youtubeUrl = yt;
  return entry;
}

export function buildAlbumEntry(appleAlbum) {
  const a = appleAlbum.attributes;
  return {
    title: a.name, year: yearOf(a.releaseDate), trackCount: a.trackCount,
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
}

export function buildSingleEntry(appleAlbum) {
  const a = appleAlbum.attributes;
  return {
    title: a.name, type: 'single', year: yearOf(a.releaseDate),
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): entry builders for video, album, single"
```

---

### Task 4: Reconcile + sort

**Files:**
- Modify: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Consumes: `extractAppleId`, `videoNumber` (Task 2).
- Produces:
  - `reconcile(existing, incoming, keyFn) -> { additions, orphans }` — `additions` are `incoming` whose key is not among `existing`; `orphans` are `existing` whose key is not among `incoming` (both keyed by `keyFn`, null keys ignored).
  - `sortVideos(videos) -> Release[]` — a new array sorted ascending by `videoNumber(title)` (entries with no number sort last, stable).

- [ ] **Step 1: Write the failing test**

```js
// add to tests/sync-catalogue.test.mjs
import { reconcile, sortVideos } from '../scripts/sync-catalogue.mjs';

const key = (e) => extractAppleId(e.appleMusicUrl);

describe('reconcile', () => {
  it('splits additions and orphans by key', () => {
    const existing = [{ appleMusicUrl: 'a/1' }, { appleMusicUrl: 'a/2' }];
    const incoming = [{ appleMusicUrl: 'a/2' }, { appleMusicUrl: 'a/3' }];
    const { additions, orphans } = reconcile(existing, incoming, key);
    expect(additions.map(key)).toEqual(['3']);
    expect(orphans.map(key)).toEqual(['1']);
  });
});

describe('sortVideos', () => {
  it('orders by 52.NN ascending', () => {
    const out = sortVideos([{ title: '52.03' }, { title: '52.01' }, { title: '52.02' }]);
    expect(out.map((v) => v.title)).toEqual(['52.01', '52.02', '52.03']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — `reconcile`/`sortVideos` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/sync-catalogue.mjs
export function reconcile(existing, incoming, keyFn) {
  const existingKeys = new Set(existing.map(keyFn).filter(Boolean));
  const incomingKeys = new Set(incoming.map(keyFn).filter(Boolean));
  const additions = incoming.filter((x) => keyFn(x) && !existingKeys.has(keyFn(x)));
  const orphans = existing.filter((x) => keyFn(x) && !incomingKeys.has(keyFn(x)));
  return { additions, orphans };
}

export function sortVideos(videos) {
  return [...videos].sort((a, b) => {
    const na = videoNumber(a.title), nb = videoNumber(b.title);
    if (na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
    if (na) return -1;
    if (nb) return 1;
    return 0;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): reconcile diff and video sort"
```

---

### Task 5: Byte-exact formatter

**Files:**
- Modify: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Produces: `formatMusicJson(obj) -> string` — `JSON.stringify(obj, null, 2) + "\n"`.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/sync-catalogue.test.mjs
import { formatMusicJson } from '../scripts/sync-catalogue.mjs';

describe('formatMusicJson', () => {
  it('uses 2-space indent, trailing newline, unescaped non-ascii, and round-trips', () => {
    const out = formatMusicJson({ a: 1, b: 'café' });
    expect(out).toBe('{\n  "a": 1,\n  "b": "café"\n}\n');
    expect(JSON.parse(out)).toEqual({ a: 1, b: 'café' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — `formatMusicJson` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/sync-catalogue.mjs
export function formatMusicJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): byte-exact music.json formatter"
```

---

### Task 6: `runSync` orchestrator

**Files:**
- Modify: `scripts/sync-catalogue.mjs`
- Test: `tests/sync-catalogue.test.mjs`

**Interfaces:**
- Consumes: all builders/reconcile/sort/extractors above.
- Produces: `runSync({ fetchJson, appleToken, youtubeKey, artistId, uploadsPlaylistId, music }) -> Promise<{ music, summary, changed }>`.
  - `fetchJson(url, headers?) -> Promise<object>` is injected (so tests need no network).
  - Fetches Apple artist `?views=full-albums,singles` (albums at `data[0].views['full-albums'].data`, singles at `data[0].views['singles'].data`), the paginated `/music-videos` relationship (following `next`, a path to prefix with `https://api.music.apple.com`), and the paginated YouTube uploads playlist (following `nextPageToken`).
  - Adds only new entries (keyed by Apple id), re-sorts `musicVideos` with `sortVideos`, and returns the merged `music`, a human summary, and `changed` (true iff any additions).
  - Summary also lists Apple orphans and YouTube-only numbers (a `videoNumber` present in YouTube but in neither existing nor Apple videos).

- [ ] **Step 1: Write the failing test**

```js
// add to tests/sync-catalogue.test.mjs
import { runSync } from '../scripts/sync-catalogue.mjs';

function makeFetch(routes) {
  // routes: array of [substring, responseObject]; first match wins
  return async (url) => {
    for (const [needle, resp] of routes) if (url.includes(needle)) return resp;
    throw new Error(`unexpected url ${url}`);
  };
}

describe('runSync', () => {
  it('adds new Apple entries, matches youtube, reports orphans and youtube-only', async () => {
    const music = {
      artist: { name: 'Chaos of Zen' },
      albums: [{ title: 'A1', appleMusicUrl: 'https://music.apple.com/us/album/a/100' }],
      singles: [{ title: 'S1', type: 'single', appleMusicUrl: 'https://music.apple.com/us/album/s/200' }],
      musicVideos: [{ title: '52.01', type: 'video', appleMusicUrl: 'https://music.apple.com/us/music-video/52-01/300' }],
    };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const fetchJson = makeFetch([
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [
          { attributes: { name: 'A1', url: 'https://music.apple.com/us/album/a/100', artwork: art, releaseDate: '2014', trackCount: 5 } },
          { attributes: { name: 'A2', url: 'https://music.apple.com/us/album/a/101', artwork: art, releaseDate: '2015', trackCount: 7 } },
        ] },
        singles: { data: [
          { attributes: { name: 'S1', url: 'https://music.apple.com/us/album/s/200', artwork: art, releaseDate: '2021' } },
        ] },
      } }] }],
      ['/music-videos', { data: [
        { attributes: { name: '52.01', url: 'https://music.apple.com/us/music-video/52-01/300', artwork: art, releaseDate: '2022-01-01' } },
        { attributes: { name: '52.02', url: 'https://music.apple.com/us/music-video/52-02/301', artwork: art, releaseDate: '2022-02-01' } },
      ] }],
      ['playlistItems', { items: [
        { snippet: { title: 'Chaos of Zen - 52.02', resourceId: { videoId: 'YT2' } } },
        { snippet: { title: 'Chaos of Zen - 52.23', resourceId: { videoId: 'YT23' } } },
      ] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.changed).toBe(true);
    expect(res.music.albums.map((a) => a.title)).toEqual(['A1', 'A2']);       // A2 added
    expect(res.music.musicVideos.map((v) => v.title)).toEqual(['52.01', '52.02']); // 52.02 added, sorted
    const v2 = res.music.musicVideos.find((v) => v.title === '52.02');
    expect(v2.youtubeUrl).toBe('https://youtube.com/watch?v=YT2');            // matched
    expect(res.summary).toContain('52.23');                                    // youtube-only flagged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: FAIL — `runSync` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/sync-catalogue.mjs
async function fetchAppleAll(fetchJson, startUrl, headers) {
  let url = startUrl;
  const out = [];
  while (url) {
    const page = await fetchJson(url, headers);
    out.push(...(page.data || []));
    url = page.next ? `https://api.music.apple.com${page.next}` : null;
  }
  return out;
}

async function fetchYouTubeAll(fetchJson, playlistId, key) {
  const out = [];
  let token = '';
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails`
      + `&playlistId=${playlistId}&maxResults=50&key=${key}${token ? `&pageToken=${token}` : ''}`;
    const page = await fetchJson(url);
    out.push(...(page.items || []));
    token = page.nextPageToken || '';
  } while (token);
  return out;
}

const appleKey = (e) => extractAppleId(e.appleMusicUrl);

export async function runSync({ fetchJson, appleToken, youtubeKey, artistId, uploadsPlaylistId, music }) {
  const headers = { Authorization: `Bearer ${appleToken}` };
  const artist = await fetchJson(
    `https://api.music.apple.com/v1/catalog/us/artists/${artistId}?views=full-albums,singles`, headers);
  const views = artist.data?.[0]?.views || {};
  const appleAlbums = views['full-albums']?.data || [];
  const appleSingles = views.singles?.data || [];
  const appleVideos = await fetchAppleAll(fetchJson,
    `https://api.music.apple.com/v1/catalog/us/artists/${artistId}/music-videos?limit=100`, headers);
  const ytItems = await fetchYouTubeAll(fetchJson, uploadsPlaylistId, youtubeKey);
  const ytMap = youtubeMapByNumber(ytItems);

  const incVideos = appleVideos.map((v) => buildVideoEntry(v, ytMap));
  const incAlbums = appleAlbums.map(buildAlbumEntry);
  const incSingles = appleSingles.map(buildSingleEntry);

  const vids = reconcile(music.musicVideos, incVideos, appleKey);
  const albs = reconcile(music.albums, incAlbums, appleKey);
  const sngs = reconcile(music.singles, incSingles, appleKey);

  const next = {
    ...music,
    albums: [...music.albums, ...albs.additions],
    singles: [...music.singles, ...sngs.additions],
    musicVideos: sortVideos([...music.musicVideos, ...vids.additions]),
  };

  const appleVideoNums = new Set(appleVideos.map((v) => videoNumber(v.attributes.name)).filter(Boolean));
  const existingVideoNums = new Set(music.musicVideos.map((v) => videoNumber(v.title)).filter(Boolean));
  const ytOnly = Object.keys(ytMap).filter((n) => !appleVideoNums.has(n) && !existingVideoNums.has(n));

  const changed = vids.additions.length + albs.additions.length + sngs.additions.length > 0;
  const lines = [];
  lines.push(`## Catalogue sync`, '');
  const list = (label, arr, f) => arr.length && lines.push(`**${label} (${arr.length}):** ${arr.map(f).join(', ')}`);
  list('New albums', albs.additions, (a) => a.title);
  list('New singles', sngs.additions, (s) => s.title);
  list('New videos', vids.additions, (v) => v.title);
  list('On YouTube, awaiting Apple Music', ytOnly.map((n) => ({ n })), (x) => x.n);
  list('In music.json but not in the Apple API — review', [...albs.orphans, ...sngs.orphans, ...vids.orphans], (e) => e.title);
  if (!changed) lines.push('Catalogue already up to date. No additions.');
  return { music: next, summary: lines.join('\n') + '\n', changed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-catalogue.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-catalogue.mjs tests/sync-catalogue.test.mjs
git commit -m "feat(sync): runSync orchestrator with injected fetch"
```

---

### Task 7: Make completeness test additive-tolerant

**Files:**
- Modify: `tests/music-completeness.test.mjs`

**Rationale:** The current test asserts exact counts (`albums` length 2, `musicVideos` length 51) and that every video has a `youtubeUrl`. An additive sync PR adds entries and may add an Apple-only video with no YouTube match, which would make CI red on exactly the PRs this feature opens. Relax to lower bounds + youtube-optional, keeping per-entry well-formedness and the no-duplicate-titles check.

**Interfaces:** None (test-only change).

- [ ] **Step 1: Update the album count assertion**

In `tests/music-completeness.test.mjs`, change the albums test:

```js
// was: expect(music.albums).toHaveLength(2);
expect(music.albums.length).toBeGreaterThanOrEqual(2);
```

- [ ] **Step 2: Update the music-videos assertions**

Replace the whole music-videos `it(...)` body with:

```js
  it('has the full music-video catalogue, well-formed, youtube optional', () => {
    expect(music.musicVideos.length).toBeGreaterThanOrEqual(51);
    for (const r of music.musicVideos) {
      expect(r.type).toBe('video');
      expect(r.artworkUrl).toMatch(URL_RE);
      expect(r.appleMusicUrl).toMatch(URL_RE);
      if (r.youtubeUrl !== undefined) expect(r.youtubeUrl).toMatch(URL_RE);
    }
  });
```

- [ ] **Step 3: Run the whole suite to verify it passes**

Run: `npm test`
Expected: PASS (214 tests, adjusted assertions green against the current data).

- [ ] **Step 4: Commit**

```bash
git add tests/music-completeness.test.mjs
git commit -m "test(music): lower-bound counts so additive sync PRs stay green"
```

---

### Task 8: `main()` runner + workflow

**Files:**
- Modify: `scripts/sync-catalogue.mjs` (add `main()` + runner guard)
- Modify: `package.json` (add `sync:catalogue` script)
- Create: `.github/workflows/sync-catalogue.yml`

**Interfaces:**
- Consumes: `runSync`, `buildDeveloperToken`, `formatMusicJson`.
- Produces: a runnable script (`node scripts/sync-catalogue.mjs`) that reads env secrets, updates `public/data/music.json` in place when changed, and writes the summary to `sync-summary.md`.

- [ ] **Step 1: Add `main()` and the runner guard**

```js
// add to scripts/sync-catalogue.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

async function fetchJsonReal(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function main() {
  const { APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_TEAM_ID, YOUTUBE_API_KEY } = process.env;
  for (const [k, v] of Object.entries({ APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_TEAM_ID, YOUTUBE_API_KEY }))
    if (!v) throw new Error(`missing required env var ${k}`);

  const appleToken = buildDeveloperToken({
    teamId: APPLE_MUSIC_TEAM_ID, keyId: APPLE_MUSIC_KEY_ID, privateKey: APPLE_MUSIC_PRIVATE_KEY });
  const path = 'public/data/music.json';
  const music = JSON.parse(readFileSync(path, 'utf8'));

  const { music: updated, summary, changed } = await runSync({
    fetchJson: fetchJsonReal, appleToken, youtubeKey: YOUTUBE_API_KEY,
    artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

  writeFileSync('sync-summary.md', summary);
  if (changed) writeFileSync(path, formatMusicJson(updated));
  console.log(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Verify unit tests still pass (import must not trigger `main`)**

Run: `npm test`
Expected: PASS — importing the module for tests does not run `main()` (guarded by the `argv[1]` check).

- [ ] **Step 3: Add the package.json script**

In `package.json` `"scripts"`, add:

```json
"sync:catalogue": "node scripts/sync-catalogue.mjs",
```

- [ ] **Step 4: Create the workflow**

```yaml
# .github/workflows/sync-catalogue.yml
name: Catalogue sync
on:
  workflow_dispatch: {}
permissions:
  contents: write
  pull-requests: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Run catalogue sync
        env:
          APPLE_MUSIC_PRIVATE_KEY: ${{ secrets.APPLE_MUSIC_PRIVATE_KEY }}
          APPLE_MUSIC_KEY_ID: ${{ secrets.APPLE_MUSIC_KEY_ID }}
          APPLE_MUSIC_TEAM_ID: ${{ secrets.APPLE_MUSIC_TEAM_ID }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
        run: node scripts/sync-catalogue.mjs
      - name: Open PR if changed
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if git diff --quiet -- public/data/music.json; then
            echo "Catalogue already up to date — no PR."
            exit 0
          fi
          BRANCH="autosync/catalogue-${{ github.run_id }}"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add -f public/data/music.json
          git commit -m "chore(music): auto-sync catalogue additions"
          git push origin "$BRANCH"
          gh pr create --base main --head "$BRANCH" \
            --title "Catalogue auto-sync: new releases" \
            --body-file sync-summary.md
```

**Note on repo layout:** confirmed — the git repo root *is* the `website` package (`.github/workflows/ci.yml` sits at the root and runs `npm ci`/`npm test` with no `working-directory`), so no `working-directory` is set here, matching the existing CI workflow.

- [ ] **Step 5: Validate the workflow YAML syntax**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-catalogue.yml')); print('yaml ok')"`
Expected: `yaml ok` (if PyYAML is unavailable, instead run `node -e "require('fs').readFileSync('.github/workflows/sync-catalogue.yml','utf8')"` and eyeball the indentation — GitHub validates it on push).

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-catalogue.mjs package.json .github/workflows/sync-catalogue.yml
git commit -m "feat(sync): main() runner, npm script, and workflow_dispatch workflow"
```

---

## Post-implementation (human, outside this plan)

1. Maintainer adds the four repo secrets (never handled by the agent).
2. Open the PR for the branch; CI runs the unit tests.
3. After merge, trigger **Actions → Catalogue sync → Run workflow** once — this is the true integration test (live Apple/YouTube calls, real ES256 signature acceptance, real PR creation). Watch the run log and the resulting PR (or the "already up to date" no-op).

## Self-Review

- **Spec coverage:** Sources & auth → Tasks 1, 6, 8. Merge semantics (additive, keyed by Apple id, orphans reported) → Tasks 4, 6. Field mapping → Task 3. Video↔YouTube matching + mismatch (52.23/52.29) → Tasks 2, 3, 6. Formatting/`git add -f` → Tasks 5, 8. Workflow (`workflow_dispatch`, `gh` PR) → Task 8. Testing strategy + verification limits → Tasks 1–6 (unit) and Post-implementation (integration). Completeness-test brittleness against additions (implied by "PR + CI + additive") → Task 7. No gaps.
- **Placeholder scan:** none — every code/test step carries complete content.
- **Type consistency:** `extractAppleId`, `videoNumber`, `fillArtwork`, `youtubeMapByNumber`, `buildVideoEntry`, `buildAlbumEntry`, `buildSingleEntry`, `reconcile`, `sortVideos`, `formatMusicJson`, `runSync`, `buildDeveloperToken`, `main` are named identically wherever referenced across tasks; `appleKey`/`key` helpers use `extractAppleId(e.appleMusicUrl)` consistently.
