# Music/Video Section Design Spec

**Date:** 2026-07-21
**Status:** Approved pending user review
**Project root:** `/Users/joe/Pictures/Art/365 Strange Attractors/website/`

## 1. Purpose

Add a new top-level section to the site showcasing Joe's music/video releases as Chaos of Zen, distinct from the 2010 attractor archive. A discography-style page linking out to Apple Music, YouTube, and Spotify — not embedded playback. Visually its own thing (not styled to match the constellation), but reachable through the same overlay-button navigation pattern as Index/Time.

**Success criteria:**
- A visitor can find and open the Music section from a persistent corner button, browse albums/videos/singles with cover art, and reach the actual listening/watching experience on Apple Music, YouTube, or Spotify in one click.
- Content reflects the real Chaos of Zen catalog as of this writing, not placeholders.

## 2. Source Material

| Source | URL | What it provides |
|---|---|---|
| Apple Music artist page | `https://music.apple.com/us/artist/chaos-of-zen/424257434` | Albums, Singles & EPs, Music Videos, bio Q&A, artwork URLs |
| YouTube playlist "52" | `https://youtube.com/playlist?list=PLXZ06Hw0ql3qQMu3zh4naw_vwFt28wNPa` | "52 tracks in 52 weeks" (2021), 53 videos numbered 52.01–52.52, matches Apple's numbered singles/videos 1:1 by number |
| YouTube channel | `https://youtube.com/@chaosofzen` | General channel link |
| Spotify artist page | `https://open.spotify.com/artist/2kyJGKFwjut7J2itBQkwwa` | General artist link |

Both YouTube and Spotify links were verified during brainstorming to resolve to the correct "Chaos of Zen" artist.

**Known catalog shape** (from initial research; final counts confirmed during implementation via a full scrape, not the partial preview Apple's page shows by default):
- 2 albums: *Random Acts of Ambients, Vol. 1* (2011), *Vol. 2* (2019)
- 6 items Apple Music categorizes as "Music Videos" (2022): 52.32, 52.52, 52.06, 52.07, 52.39, 52.46
- A larger, still-growing catalog of numbered Singles & EPs (2026 rolling re-release of the 2021 "52" project) — Apple's page previews only 7 (52.14–52.20) but references numbers up to at least 52.51 elsewhere on the page, so the true list is longer and must be scraped in full, not taken from the preview.
- One track on Apple's page, "J****o Protagonista (feat. Joe Chavez)" from "En la Cigarra · 2013," is excluded — it's an unrelated artist matched by name coincidence, not part of the Chaos of Zen catalog.

**YouTube "52" playlist edge cases** (resolved during brainstorming):
- Video at position 14 is untitled on YouTube ("Track 14 of 52") → treated as 52.14's video by playlist position.
- "52.15" exists as both a plain version and a "52.15 Square" version (same length) → use the plain version.
- "52.49 NASA's James Webb Space Telescope #UnfoldTheUniverse Art Challenge" shares a number with 52.49 by coincidence but is a one-off bonus video, not part of the core numbered series → excluded.

## 3. Architecture

No backend, no live API calls to Apple Music/YouTube/Spotify at runtime (none offer a CORS-friendly public JSON endpoint usable from a static GitHub Pages site). Data is a static, committed JSON file populated once via research/scraping now, refreshed manually later the same way `artworks.json`/`attractors.json` already are.

- **Data**: `public/data/music.json` — see schema below.
- **View**: new `MusicView` class (`src/musicview.ts`), following the existing `IndexView` pattern — a full-screen DOM overlay appended to `#overlay`, opened/closed via the router, closable via ×/Escape/click-outside.
- **Routing**: new `{ kind: 'music' }` route in `router.ts` (`/music/`). Note: the router already has an unused `{ kind: 'about' }` stub with no view behind it — left alone; `music` is a new, separate route kind, not a repurposing of `about`.
- **Navigation**: new "Music" button in `main.ts`, positioned alongside the existing Index/Time buttons, wired the same way (`indexBtn`/`timeBtn` pattern).
- **Cover art**: hotlinked directly from Apple Music's own artwork CDN URLs (no downloading, no image-pipeline integration) — simplest option, standard practice for showcase/link-out pages, and these are Apple's own official images for the artist's own releases.

## 4. Data Model

```ts
interface MusicData {
  artist: {
    name: string;               // "Chaos of Zen"
    bio: string;                 // adapted from Apple's Q&A into short prose, not literal Q&A
    appleMusicUrl: string;
    youtubeUrl: string;          // channel-level: https://youtube.com/@chaosofzen
    spotifyUrl: string;          // artist-level: https://open.spotify.com/artist/2kyJGKFwjut7J2itBQkwwa
  };
  albums: Album[];
  musicVideos: Release[];
  singles: Release[];
}

interface Album {
  title: string;
  year: number;
  trackCount: number;
  artworkUrl: string;
  appleMusicUrl: string;
}

interface Release {
  title: string;               // e.g. "52.14"
  type: 'single' | 'ep' | 'video';
  year: number;
  artworkUrl: string;
  appleMusicUrl: string;
  youtubeUrl?: string;          // present only when a matching numbered video exists in the "52" playlist
}
```

`youtubeUrl` is per-release (matched by number against the "52" playlist), not a blanket channel link on every item — that's what `artist.youtubeUrl` is for. A release with no matching YouTube number (e.g. released after 52.52, or never uploaded) simply omits the field; the UI shows only the platform links that actually exist for that release, never a broken or guessed one.

## 5. Layout

Top to bottom, within the `MusicView` overlay:

1. **Header** — "Chaos of Zen" title, bio (2-3 short paragraphs adapted from Apple's Q&A: earliest musical memory, favorite albums, the "Eight-02.26" piece), then three link buttons: Apple Music / YouTube / Spotify (artist-level links).
2. **Albums** — 2 larger cards side by side: cover art, title, year, track count, linking to Apple Music.
3. **Music Videos** — 6-item thumbnail grid: art, title, year; each linking to Apple Music, plus a YouTube link where the number-match exists (all 6 should match, since they fall within the 52.01–52.52 range).
4. **Singles & EPs** — full catalog as a compact grid (small thumbnail, title, year), scrollable, no pagination; each linking to Apple Music, plus YouTube where matched.

Visual style: distinct from the constellation's sprite/particle aesthetic — a more conventional dark-themed discography layout, consistent with the site's existing overlay chrome (colors, typography, corner-button placement) but not trying to look like part of the attractor visualization.

## 6. Error Handling

- Apple Music CDN artwork fails to load → browser's normal broken-image behavior is acceptable here (low risk: these are Apple's own stable production URLs for a live artist page); no special fallback UI planned.
- A release with no `youtubeUrl` → simply don't render a YouTube link/icon for that item.
- `music.json` fails to load/parse at runtime → `MusicView` shows nothing rather than crashing the rest of the app (mirrors how other views degrade independently).

## 7. Testing

- A data-validation test (in the style of the pipeline's existing completeness checks) asserting every entry in `music.json` has its required fields and that URLs are well-formed.
- A basic render/open-close test for `MusicView`, mirroring the existing `IndexView`/`PieceView` test coverage (open via router, close via router, no exceptions).
- No visual/pixel testing planned — this section has no generative rendering, so manual browser verification (screenshot + click-through) covers the rest.

## 8. Out of Scope (this pass)

- Embedded playback (audio previews, YouTube iframe embeds) — explicitly deferred; this is a link-out showcase.
- Self-hosted/optimized cover art — using Apple's hotlinked URLs instead.
- Per-track Spotify links — only the artist-level Spotify link is included; Spotify per-release matching wasn't investigated the way the YouTube "52" playlist was.
- Automatic/live syncing with Apple Music for future releases — updates are a manual re-scrape + commit, same as the rest of the site's curated data.
