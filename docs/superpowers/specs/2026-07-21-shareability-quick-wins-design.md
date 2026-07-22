# Shareability Quick Wins — Design Spec

**Date:** 2026-07-21
**Status:** Approved pending user review
**Project root:** `/Users/joe/Pictures/Art/365 Strange Attractors/website/`
**Parent context:** First of four improvement passes chosen after a live-site audit
(1. shareability quick wins → 2. constellation weight+framing → 3. about page → 4. piece-view affordances).

## 1. Purpose

Make chaosofzen.dev present correctly when shared and discoverable when crawled.
Today the root page has no description, no OG/Twitter tags, and no favicon; day pages
have OG tags with *relative* image URLs (which most scrapers reject); there is no
sitemap; and the artist is credited nowhere on the site.

**Success criteria:**
- Pasting `https://chaosofzen.dev/` into Slack/iMessage/Bluesky/X renders a rich card:
  the 2010 "365" photomosaic, the site title, and a factual description.
- Pasting any `/day/NNN-slug/` URL renders a card with that day's artwork.
- Browser tabs and bookmarks show a favicon.
- `https://chaosofzen.dev/sitemap.xml` lists the root page and all 365 day pages.
- Joe Chavez is credited in page metadata.
- Zero changes to runtime WebGL/app code.

## 2. Content decisions (settled with user)

- **Site-wide card image:** the 2010 photomosaic (`mosaic/365_Moaic_No_Watermark.png`
  in the archive), cropped to 1200×630 centered so the "365" numerals stay whole.
  Framing checked visually before landing.
- **Site description (factual tone):**
  "One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez,
  each re-rendered live in your browser from its original 2010 parameter file."
- **Attribution:** Joe Chavez, via `<meta name="author">` on all pages. (Visible
  on-page credit belongs to the upcoming /about/ page, not this pass.)
- **Favicon source:** one radially symmetric artwork, default **086 Medusa**,
  cropped tight, brightness-lifted to read on light tabs. User may substitute
  another day before implementation.

**Out of scope:** /about/ page, JSON-LD structured data, any WebGL or app-runtime change.

## 3. Architecture

Two head-rendering paths must stay in sync:

| Page | Built by | Deployed by |
|---|---|---|
| Root `index.html` | Vite (tracked in git) | CI on green main push |
| 365 × `/day/NNN-slug/` | pipeline (`pages.mjs`, gitignored output) | `scripts/deploy.sh` (local content deploy) |

**`pipeline/site.mjs` — single source of truth.** Exports:
- Constants: `ORIGIN` (`https://chaosofzen.dev`), `SITE_TITLE`, `SITE_DESCRIPTION`,
  `AUTHOR`, `CARD_IMAGE` (`{ path: '/og/card.jpg', width: 1200, height: 630, alt }`).
- `metaTags({ title, description, image, url, type })` → string of head tags:
  `<meta name="description">`, `og:title/description/type/url/site_name/image/image:width/image:height/image:alt`,
  `twitter:card=summary_large_image`, `twitter:title/description/image`,
  `<link rel="canonical">`, `<meta name="author">`, favicon `<link>`s.
  All values escaped via the existing `esc()`; all URLs absolute (prefixed with `ORIGIN`).

**Root page:** a `transformIndexHtml` Vite plugin in `vite.config.ts` imports
`site.mjs` and replaces a placeholder comment in `index.html` with
`metaTags({ type: 'website', url: '/', image: CARD_IMAGE, … })`.

**Day pages:** `renderPiecePage()` calls the same `metaTags()` with the day's title,
its 1024px JPEG as the image, and `${ORIGIN}/day/${slug}/` as canonical URL.
Existing figure/picture markup unchanged.

## 4. New pipeline steps (`build.mjs`)

All idempotent — skip when output exists unless `--force`, matching the derivatives
pattern. All fail loudly (non-zero exit) if their source input is missing; these are
build inputs, not optional extras.

1. **`buildOgCard()`** — sharp: load archive mosaic → crop to 1200×630 centered on
   the numerals → JPEG quality ~80, target ≈200 KB → `public/og/card.jpg`.
2. **`buildFavicons()`** — sharp, from the favicon-source artwork's master:
   `public/favicon.ico` (32px), `public/icon.svg` (SVG wrapper embedding a 64px
   raster), `public/apple-touch-icon.png` (180px). Tight center crop + brightness lift.
3. **`buildSitemap()`** — from the `days` manifest: `public/sitemap.xml` with 366
   `<url>` entries (root + days), absolute URLs.

## 5. Deployment

- `og/card.jpg`, favicons, and `sitemap.xml` are small and stable → **tracked in git**
  (targeted un-ignore entries in `.gitignore`). CI's code-only deploy already copies
  tracked `public/` files, so they ship on every green push and can never be silently
  absent from the live site.
- Updated day-page HTML ships via one `scripts/deploy.sh` run after merge.
- **Manual step (user):** add `Sitemap: https://chaosofzen.dev/sitemap.xml` to
  robots.txt in the Cloudflare dashboard — Cloudflare manages that file.

## 6. Error handling

- Missing mosaic source / favicon source artwork → pipeline exits non-zero with a
  clear message naming the expected path.
- `metaTags()` escapes title/description/alt through `esc()`; malformed input cannot
  break out of attributes.
- No runtime code is touched; a bad card image degrades to a plain link preview,
  never a broken site.

## 7. Testing

- `tests/pages.test.mjs` (extend): day-page `og:image`/`og:url`/canonical are
  absolute `https://chaosofzen.dev/…`; `twitter:card` present; escaping holds.
- `tests/site.test.mjs` (new): `metaTags()` emits every required tag; constants
  are non-empty; description matches the agreed copy.
- Root-injection test: the plugin's transform function is exported and unit-tested
  directly — given the placeholder `index.html`, output contains the description,
  card image URL, and favicon links (no `vite build` invocation in tests).
- Sitemap test: 366 entries, all absolute, parseable XML.
- Post-deploy manual: paste root + one day URL into a real unfurler
  (Slack/opengraph.xyz); `curl -I` favicon, card, sitemap → 200.
