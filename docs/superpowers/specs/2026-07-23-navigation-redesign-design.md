# Navigation Redesign — Design Spec

**Date:** 2026-07-23
**Status:** Approved (brainstormed with Joe; approach B "Living nav" chosen over A "Chrome evolution" and C "Scene-first morph")
**Supersedes:** roadmap pass 4 (piece-view affordances) — absorbed here. Reserves the slot for pass 3 (story content).
**Prerequisite:** `feat/constellation-weight-framing` (pass 2) must merge first — this design consumes its `fitCamera`, lazy view construction, and sprite-brightness uniform.

## Problem

The site is an immersive 3D constellation wearing generic chrome: three pill buttons top-right
(`Music`, `Index`, `Time`) with labels that explain nothing (`Time` means "arrange by date"),
an auto-dismissing intro card, and a piece view whose actions (`Hide Image`, brightness slider,
anonymous arrows and ×) are invisible or unnamed. The front page is static — every visit opens
on the same wide view with no focal point, despite the project's premise being *one attractor
per day*.

## Decisions (agreed during brainstorm)

1. **Dynamic = both** — a living scene AND a daily focal point.
2. **Nav speaks the site's own poetic language** — evocative names, each still guessable,
   with `title` tooltips as the plain-language safety net.
3. **Nav contents:** Today, Attractors (all 365), Sound, Story. Four words:
   **Today · Attractors · Sound · Story**.
4. **Time toggle demotes** to a quiet scene control — it's a way of viewing the constellation,
   not a destination.
5. **Every day gets its sound** — the piece view is designed around a per-day listen action now,
   even though audio files arrive later (AttractorSonifier has all 365 days composed; production
   to audio is per-piece via Ableton and not yet run).
6. **One coherent pass** — front page, nav, and piece-view actions share one vocabulary.
7. **Landing composition:** "Drift & Settle" (arrive inside the constellation, camera settles on
   today's glowing piece) with the hero option's listen affordance in the caption.

## 1. The arrival

**Resolving "today":** today's piece is the 2010 date matching the visitor's current local
month/day. July 23 → day 204. Feb 29 (leap years) → Feb 28's piece. Pure function
`resolveToday(date: Date): slug`, unit-tested including the leap-day case.

**Sequence (home route only):**

1. Cold load opens on pass 2's whole-cloud framing (`fitCamera` — whole constellation, centered).
2. As soon as sprites are visible (small atlas tier loaded), the camera makes a single ~2.5 s
   eased flight toward today's piece — close enough to read as *the* subject (~15% of viewport
   height), still inside the field of neighbors. One motion, no cuts.
3. Today's sprite carries a quiet glow — a per-sprite highlight uniform extending pass 2's
   sprite-brightness mechanism.
4. A caption fades in beside the sprite: date, title, and the listen affordance when that day
   has audio.
5. First visit only: one line of gesture hints under the caption
   ("drag to wander · scroll to dive · click to open"). This **replaces** the current
   auto-dismissing intro card entirely — `#intro-card` is removed; the existing
   `la-intro-seen` localStorage key is reused as the first-visit flag for the hint line.
6. Any user input (pan, zoom, click, key) ends the flight instantly — the visitor always wins.

**Edge cases:**

- `prefers-reduced-motion`: no flight; page opens already framed on today, glow + caption present.
- Deep links (`/day/…`, `/attractors/`, `/sound/`, `/story/`): no settle — arrival-on-today is
  the home route's behavior only.
- Return visits: still settle. The flight path changes as the year progresses — that, plus the
  daily focal piece, is what makes each visit different.
- WebGL unavailable: current static-page fallback unchanged.

## 2. The word-row and the four destinations

**The row:** `Today · Attractors · Sound · Story`, bottom center, Georgia serif, letter-spaced,
interpuncts between words. Replaces the three top-right pill buttons. Words are real `<a>` links
(router intercepts clicks, as now) so middle-click, hover preview, and crawlers work. Active
destination underlined/lit; hover glow matches the sprite glow. Mobile: same row, slightly
smaller, bottom-center (thumb zone); minimap stays hidden on mobile as today.

- **Today** → flies to today's piece and **opens** it (full piece view — unlike the landing
  settle, which stops at the glowing caption). `/today/` resolves, then `history.replaceState`
  to the real `/day/NNN-slug/` so a shared URL always captures the specific day.
- **Attractors** → the index view restyled as a **translucent veil**: background drops from
  `rgba(4,5,8,0.94)` to ~0.75 opacity with backdrop blur; the constellation keeps drifting
  behind the search field and month grids. Day cells become real links (fixes
  buttons-not-links). `/index/` redirects to `/attractors/`.
- **Sound** → the music view (discography), same veil treatment. `/music/` redirects to
  `/sound/`. Gains a section slot for the sonification project — a one-paragraph teaser now
  ("every day's attractor composes its own music — coming"), so the word honestly covers both
  meanings.
- **Story** → reserved slot, shipped live: a short interim page (factual site description,
  attribution to Joe Chavez, a line about 2010) in the veil style. Pass 3 replaces the content.
  No dead link.

**Keyboard:** `/` opens Attractors with search focused; `Escape` returns home; `t` goes to
Today. All four words carry `title` tooltips (e.g. "Attractors — browse all 365 days").

## 3. Piece-view actions and scene controls

Piece view controls become visible, labeled, serif-set — one vocabulary with the nav:

- **‹ ›** remain arrows, gaining visible hover/focus labels naming the destination:
  "day 203" / "day 205".
- **×** becomes the word **Sky** (with × glyph beside it) — return to the constellation.
  Styled like the word-row so closing reads as navigation, not dismissal.
- **Hide Image** becomes a two-word mode toggle **Image | Orbit** — lit word = current mode.
  "Orbit" shows the live attractor; "Image" the static render. Brightness slider appears only
  in Orbit mode, restyled to match.
- **Listen** — a small ▶ beside the caption ("Listen — 3:42" once durations exist). Renders
  only for days whose data carries an `audio` field; absent = hidden (no disabled buttons).
  The caption layout reserves the slot so audio landing later changes no design.
- **Caption** gains its system family: day number, date, title, and attractor family/backend
  name (e.g. "Lorenz") as a quiet metadata line.

Scene controls (home only):

- **Minimap:** bottom-left, unchanged.
- **Time toggle** demotes to a two-word switch above the minimap: **Likeness | Date** — the two
  arrangements of the sky, lit word = current. Tooltip: "arrange the constellation by visual
  similarity / by calendar date". On mobile (minimap hidden) the switch sits bottom-left in
  the minimap's place.
- Word-row, minimap, and the switch all hide while any veil or piece is open (generalizing the
  current label-hiding logic). The scene's chrome belongs to the scene.

## 4. Architecture

- **`src/nav.ts`** (new): builds the word-row, owns active-state and show/hide. Replaces the
  ad-hoc button creation in `main.ts`, which shrinks.
- **`src/today.ts`** (new): pure functions — `resolveToday(date)` and settle-target math.
- **`Router`**: new routes `/today/`, `/attractors/`, `/sound/`, `/story/`; redirects
  `/index/` → `/attractors/`, `/music/` → `/sound/`, `/today/` → resolved `/day/NNN-slug/`.
- **Glow**: rides the sprite-shader uniform mechanism from pass 2 (highlight index uniform).
- **Piece view**: changes contained in `piece.ts`.
- **Veils**: CSS on the existing index/music views.
- **Pipeline**: sitemap gains `/attractors/`, `/sound/`, `/story/`; day pages' static HTML gets
  the new nav links for crawlers; caption's family line joins from the sonifier's
  `features.json` backend name at pipeline time (no runtime fetch).
- **Data**: artworks data gains optional per-day `audio` (URL). Absent everywhere today.

## 5. Testing

House convention (no jsdom): pure functions unit-tested — `resolveToday` (incl. Feb 29),
route parsing and redirects, settle-target math. DOM/GL behavior — settle flight, glow, veils,
word-row states, piece-view controls — verified live in the browser in a final checklist task.

## Out of scope

- Producing or hosting any audio (design reserves the slot only).
- Story page content (pass 3 writes it; this ships the interim paragraph).
- 3D grid-morph browsing (approach C — possible future pass).
- Any change to piece-view image loading or the pass-2 atlas/framing work.

## Sequencing

Spec lands now. Implementation branches from `feat/constellation-weight-framing` after it
merges (its `fitCamera`, lazy views, and brightness uniform are prerequisites). This pass
absorbs roadmap pass 4; pass 3 (story content) plugs into the reserved Story page.
