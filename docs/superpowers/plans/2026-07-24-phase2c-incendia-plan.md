# Phase 2c — Incendia Live Orbits Implementation Plan

**Date:** 2026-07-24
**Spec:** `docs/superpowers/specs/2026-07-23-phase2c-incendia-design.md`
**Branch:** `feat/incendia-completion`
**Status:** Phase 0 (decoding spike) IN PROGRESS — core `.par` format cracked; verification harness next.

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
line 21 …     : <transformCount> transform blocks, each:
                  row0: a b c tx    (4 floats)
                  row1: d e f ty    (4 floats)   3×4 affine: 3×3 linear + translation col
                  row2: g h i tz    (4 floats)
                  w              : weight (1 float)
(then)        : per-transform 2D control pairs, camera, gradients, texture refs,
                and a 256-entry hex palette block — ALL render-only noise, ignorable.
```

**Result:** anchoring at line 21 and reading exactly `transformCount` blocks yields a clean
`[4,4,4,1]×N` read for **276/280 files (98.6%)** — gen4 96/98, gen6 82/82, gen7 98/100.
`declaredCount == foundBlocks` for the same 276. This clears **exit criterion (a)** for all
three generations, not just one.

### Key finding — weights are NOT normalized
Initial "weights sum to ~1.0" hypothesis is FALSE as a hard invariant:
- single-transform files frequently carry weight `0.5` or `1.0` (irrelevant — one transform is
  always selected);
- multi-transform sums are arbitrary (`2.0` = two equal 1.0 weights, `1.1`, `0.714`, …).
Incendia treats weights as **relative probabilities** and normalizes at iteration time.
⇒ Normalize (`w_i / Σw`) when building the cumulative-weight selector. ⇒ Weight-sum is
**not** a parse-validation signal; the render-and-compare harness is the only real check.

### Open items still in the spike
1. **~4 non-contiguous files** (087 declared 4/found 2, 129 declared 3/found 2, …): `transformCount`
   exceeds the contiguous run at line 21 — some transforms stored in a later section (gen7-heavy).
   Decide: recover them, or let those days fall to `static-only`.
2. **Affine semantics** — a clean block read does NOT prove correctness. Must confirm via render:
   row-major vs column-major linear part, translation-column vs separate-translation, coordinate
   handedness, and the line-3 global scale's role.
3. **Verification harness (the spike's lasting artifact)** — CPU chaos-game renderer → thumbnail →
   similarity score (SSIM on downscaled grayscale + palette-histogram distance) vs the day's 2010
   render. Calibrate thresholds against the 51 known-correct live Chaoscope days (guards against a
   harness that passes/fails everything).
4. **Web research** (bounded, in-flight): public Incendia format/transform-model info to corroborate
   the affine semantics before committing the parser.

### Exit
- (a) met on the block structure; **not exiting Phase 0 until the harness confirms semantics** on a
  majority of days per generation. Then → Tasks below.

---

## Tasks 1+ (gated on Phase 0 harness) — per spec §4–§7
1. `pipeline/incendia.mjs`: `.par` → `{day, slug, system:'incendia_ifs', transforms, weights}`; failures → `static-only`. Precedence: never override an existing live Chaoscope day. Report parsed/unparsed per generation.
2. `incendia_ifs` `AttractorFamily` on the Phase 2b chaos-game core (hash → cumulative-weight select → 3×4 affine apply). Inherit palette/tiers/NaN-rescue/disturb. Morph only when matrix counts match.
3. Tests: harness calibration (51 Chaoscope days score plausible), RED→GREEN parser fixtures per generation, completeness (live floor ≥85, grows), non-degenerate-spread smoke test.
4. Pipeline run, regenerate `attractors.json`, visual spot-check newly-live days, full regression green, ship (CI for tracked data/code; no new gitignored artifacts expected).
