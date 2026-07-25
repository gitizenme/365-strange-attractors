# Phase 2c — Incendia Live Orbits Implementation Plan

**Date:** 2026-07-24
**Spec:** `docs/superpowers/specs/2026-07-23-phase2c-incendia-design.md`
**Branch:** `feat/incendia-completion`
**Status:** Phase 0 (decoding spike) — format cracked AND render-confirmed; harness built. Ready for Task 1.

> Follows the established per-phase TDD pattern. Phase 0 is a time-boxed spike where
> *knowledge is the deliverable*; Sections/Tasks 1+ (parser, family, integration) start only
> after the render-and-compare harness confirms the parse is semantically correct.

---

## Phase 0 — Decoding spike

### Corpus (verified 2026-07-24)
- **301** `.par` in `project/NNN/`, **40** in `ideas/` (ideas = `XXX_`-prefixed, not day-classified → out of scope).
- Day-file selection: one file per `project/NNN/` dir, day-numbered file preferred over `XXX_` copies → **280 day-files**.
- Three format generations by first line (Incendia major version):
  - `4 1` — 98 day-files
  - `6 1` — 82 day-files
  - `7 1` — 100 day-files

### Format — CONFIRMED (probe: `scripts/spike/par_probe.mjs`, 276/280 clean)
The transform section is identical across all three generations:

```
line 1        : "<major> 1"                 version marker (4 / 6 / 7)
line 2        : "<W> <H>"                    render size
line 3        : "<s> <1/s>"                  scale + inverse
lines 4–5     : flags
line 6        : "<baseShapeId> <transformCount>"   <-- the count that anchors the parse
lines 7–20    : camera / render setup (14 lines, fixed)
line 21 …     : <transformCount> transform blocks, 4 lines each (12 floats + weight):
                  row0: 4 floats ┐
                  row1: 4 floats ├─ 12 floats: COLUMN-MAJOR 3×3 linear (first 9)
                  row2: 4 floats ┘   + translation = last 3 of row2 (flat[9..11])
                  w   : 1 float  = weight
(then)        : per-transform 2D control pairs, camera, gradients, texture refs,
                and a 256-entry hex palette block — ALL render-only noise, ignorable.
```

**Result:** anchoring at line 21 and reading exactly `transformCount` blocks yields a clean
read for **276/280 files (98.6%)** — gen4 96/98, gen6 82/82, gen7 98/100.

### Transform decode — CONFIRMED BY RENDERING (the critical finding)
Reading the top 3 rows as a naive **row-major** affine `[L|t]` is WRONG — it produces a
**singular matrix** whose chaos game collapses to a starburst of rays (a degenerate 1-D set).
The correct packing, cross-validated three ways:
- the 12 floats are **column-major 3×3 linear** (`m[i][j] = flat[j*3+i]`) **+ translation =
  the last 3 floats** (`flat[9..11]`, i.e. row2 cols 1–3);
- verified against Medusa's own *expanded* rotation×scale block (lines 67–74): the 9 linear
  floats are exactly `scale·rot` in column-major order, and the translation matches;
- verified by the web-research strand, which recovered real 2009 Incendia sample `.par` files
  and **rendered pixel-exact Sierpinski + Menger** from this same layout (row-major read makes
  those singular too). Public format docs do NOT exist — this decode is empirical.
- With the fix, **Medusa renders as its feathery frond and Skyscrapers as its cube-city** —
  the "living skeletons" match the 2010 artwork.

### Weights are NOT globally normalized
Single-transform files carry weight `0.5`/`1.0` (irrelevant — one map always selected);
multi-transform sums are arbitrary. Research confirms weights sum to 1.0 **per base-shape
group**, not per file. ⇒ Normalize `w_i/Σw` when building the cumulative selector. ⇒ Weight-sum
is not a validation signal.

### Verification harness — BUILT (`scripts/spike/incendia_render.mjs`)
Parse → CPU chaos-game (LCG-seeded, divergence rescue) → project to best-spread plane →
density raster → PNG + **box-counting fractal dimension** classifier + corpus sweep.
- **IoU-vs-2010-render is a BROKEN metric** — a sparse skeleton barely overlaps a dense
  volumetric render, and starbursts spuriously score HIGH (day 094 starburst scored top IoU).
  Discarded. **Fractal dimension** is the reliable plausibility gate: rays ≈ D 1.0,
  single-transform fixed points D 0, genuine attractors D 1.5–2.0.
- **Corpus sweep (corrected decode):** 276 parsed → **118 plausible** (D≥1.3 & coverage≥.003).
  gen4 48/96, gen6 34/82, gen7 36/98.

### Gate tightened — isoperimetric ratio (perimeter²/area) added
A first contact-sheet review (top 30 by D) showed ~10-12/30 "plausible" tiles were actually
**solid blobs or noise-fill**, not real fractal detail — boxDim alone can't tell "genuinely
fractal boundary" from "chaos game just fills a simple convex region" (a uniform disk also
scores D≈2). Added `isoperimetricRatio()`: by the isoperimetric inequality a disk/convex blob
*minimizes* perimeter for its area, so smooth fills score near a geometric floor while jagged
fractal boundaries (holes, filaments, branches) run far higher, independent of coverage.

**Calibrated 2026-07-25** against 16 known-good / 12 known-bad days eyeballed from the first
sheet: good clustered iso 575–9686; bad split into **two** clusters — solid-blob (iso 10–278,
smooth boundary) and noisy speckle-fill (iso 14554–20079). A **band gate** `iso ∈ [300, 12000]`
catches 11/12 bad cases while passing all 16 good (one residual, day 105, sits ambiguously
inside the good band — left to the planned manual spot-check).

**Corroborating signal:** 9 of the 11 high-iso rejects are *also* flagged by the harness's own
divergence-reseed counter (non-contractive transform sets) — the "noisy" cluster isn't a
separate failure mode, it's unstable/divergent parameter sets, confirmed two independent ways.

**Iteration-count sensitivity (methodological gotcha, fixed):** iso keeps *decreasing* toward
the smooth-blob floor as iteration count grows (more points fill in internal gaps) — day 203
scored iso=693.9 at 250k iterations (falsely inside the good band) vs iso=42.2 at 400k
(correctly low). `contact_sheet.mjs` and the sweep must use the same iteration count (400k)
and raster resolution (256) or their gates silently disagree. Also fixed: the harness's CLI
block wasn't guarded against `import` side effects, and a naive `import.meta.url` direct-execution
check breaks on this repo's space-containing path — needed `pathToFileURL()`.

**Tightened corpus sweep:** 276 parsed → **101 plausible** (D≥1.3, coverage≥.003, iso∈[300,12000]).
gen4 44/96, gen6 25/82, gen7 32/98. Second contact sheet (top 30 by D) confirms: nearly every
tile is now genuine structure — nautilus spirals, organic fronds, cube-cities, wireframe mazes,
mandalas. Realistic live-coverage lift: **85 → ~186 days** (85 + 101), pending Task-1 pipeline
wiring and the per-day visual spot-check the spec already calls for for the residual edge cases.

### Addressable set (the count we drive down)
- **~118 multi-transform days render as genuine affine fractals** → live candidates. Realistic
  live-coverage lift: 85 → **~185–200** once wired through the pipeline (some plausible days
  still need per-day visual spot-check).
- **Single-transform days (~124): NOT addressable** by affine chaos game — one map = one fixed
  point (D 0); their 2010 richness is all base-shape/volumetric (out of scope) → stay static-only.
- **~12 divergent days** (non-contractive maps, high reseed counts, e.g. 239/297/318) — need a
  contraction guard or fall to static-only.
- **4 non-contiguous files** (087/129/…): `transformCount` > contiguous run → recover or static-only.

### Exit — CLEARED
Format decodes and *renders correctly* across all three generations for the multi-transform
majority. Proceed to Task 1 (pipeline parser). The harness stays as the calibration/spot-check
tool and the source of the plausibility gate.

---

## Tasks 1+ (gated on Phase 0 harness) — per spec §4–§7
1. `pipeline/incendia.mjs`: `.par` → `{day, slug, system:'incendia_ifs', transforms, weights}`; failures → `static-only`. Precedence: never override an existing live Chaoscope day. Report parsed/unparsed per generation.
2. `incendia_ifs` `AttractorFamily` on the Phase 2b chaos-game core (hash → cumulative-weight select → 3×4 affine apply). Inherit palette/tiers/NaN-rescue/disturb. Morph only when matrix counts match.
3. Tests: harness calibration (51 Chaoscope days score plausible), RED→GREEN parser fixtures per generation, completeness (live floor ≥85, grows), non-degenerate-spread smoke test.
4. Pipeline run, regenerate `attractors.json`, visual spot-check newly-live days, full regression green, ship (CI for tracked data/code; no new gitignored artifacts expected).
