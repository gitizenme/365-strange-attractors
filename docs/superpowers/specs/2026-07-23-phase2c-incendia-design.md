# Phase 2c — Incendia Live Orbits Design Spec

**Date:** 2026-07-23
**Status:** Approved pending user review
**Prerequisite:** `2026-07-23-phase2b-chaoscope-completion-design.md` — this phase reuses its generic chaos-game IFS engine capability; implementation starts only after Phase 2b ships.

## 1. Purpose

Extend the live Orbit view toward the 280 Incendia-only days by reverse-engineering Incendia's undocumented `.par` parameter format and rendering the recovered weighted-affine IFS as a live point cloud.

**Success bar (decided): best-effort, drive the count down.** Days whose `.par` resists confident parsing stay static-only with the existing graceful fallback. No all-or-nothing gate; coverage ships incrementally and later parser improvements flip more days live with zero app changes.

**Constraints (decided):**
- No Incendia install available as ground truth; work from the archive's files plus public information only.
- The 2010 renders are the artwork of record; the point cloud is the attractor's "living skeleton," not a replica of Incendia's volumetric/base-shape rendering (master-spec rendering stance).

## 2. Verified source material

- 341 `.par` files: 301 in `project/NNN/`, 40 in `ideas/` (ideas files are `XXX_`-prefixed, not day-classified; only `project/` files feed day mapping).
- **Three format generations**, split by first line: `4 1` (147 files), `6 1` (107), `7 1` (87) — almost certainly the Incendia major version.
- Structure visibly discernible in samples (e.g. `ideas/XXX_PlanetCrest.par`): header lines (render size, scale factors), a line plausibly reading *base-shape id + transform count* (`12 8`), then repeated blocks of 3 rows × 4 floats (3D affine transform) followed by a single float (weight; PlanetCrest's 8 weights of 0.125 sum to 1.0), then trailing sections (gradients/camera — ignorable for our purposes).
- Incendia is freeware by Ramiro Pérez (incendia.net); forums and documentation may describe the transform model even if not the file layout.

## 3. Phase 0 — the decoding spike (time-boxed, knowledge is the deliverable)

1. **Corpus analysis** across all 341 files, per generation: pin down where the transform count lives, block layout, weight position, translation/scale semantics, and which surrounding values are render-only noise. Cross-file invariants (weights summing to ~1.0, identity-like matrices, the render-size line matching known 2010 output sizes) are the levers.
2. **Public-info pass**: one bounded web-research session on Incendia's format and transform model. No software installs.
3. **Verification harness (the spike's lasting artifact):** a CPU chaos-game renderer (Node script under `pipeline/`) renders a candidate parse to a thumbnail; an automated similarity score against that day's 2010 render (structural similarity on downscaled grayscale + palette-histogram distance) classifies the parse **plausible** or **failed**. Exact thresholds tuned during the spike using the 51 already-live Chaoscope days as calibration (their parses are known-correct).
4. **Exit criteria:** (a) at least one generation decodes with a majority of its days scoring plausible → proceed to Section 4; or (b) the format resists → write up findings, stop; the 280 days stay static-only and no engine work is wasted.

## 4. Parser and pipeline integration

- `pipeline/incendia.mjs`: parses `.par` → `{day, slug, system: 'incendia_ifs', transforms: [...], weights: [...]}` for days passing the similarity gate; failures emit `static-only` exactly as today.
- Per-day file choice mirrors the existing `pickAttractorFile` preference (day-numbered file wins over `XXX_` copies).
- **Precedence:** days that already have a live Chaoscope entry keep it — shipped orbits never change. Incendia parsing applies only to currently static-only days.
- Pipeline output reports parsed/unparsed counts per generation — the metric we drive down.

## 5. Rendering

`incendia_ifs` is one new `AttractorFamily` on Phase 2b's chaos-game core: hash → cumulative-weight transform selection → 3D affine apply. Palette tint, device tiers, calibration, NaN rescue, WebGL2 fallback, and the disturb gesture (perturbing transform translation components) all inherit. Base shapes and volumetric rendering are deliberately not replicated. Morphs: `incendia_ifs`↔`incendia_ifs` adjacent days morph only when matrix counts match (Phase 2b's guard); everything else dissolves.

## 6. Error handling

- Parse failure or below-threshold similarity → `static-only` (existing pipeline tolerance; build always succeeds).
- Runtime divergence → existing in-shader reseed; repeated failure → existing static fallback.
- No new error surfaces in the app.

## 7. Testing

- **Spike harness calibration test:** the 51 known-correct Chaoscope days score above threshold through the same CPU renderer path (guards against a harness that passes everything or nothing).
- **RED→GREEN parser tests:** hand-decoded fixture files per generation → exact expected transforms/weights.
- **Completeness test:** every day either live-with-params or static-only; live count asserted as a floor (≥85), not an exact number, since Incendia coverage is best-effort and expected to grow.
- **Smoke test:** `incendia_ifs` family produces non-degenerate spread.
- **Visual verification:** manual spot-check of a sample of newly-live days against 2010 renders, plus the automated similarity gate for all of them.
- Full regression suite green at every task boundary.

## 8. Risks

- **The format may resist** — bounded by the Phase 0 exit criteria; worst case costs only the spike.
- **A plausible-scoring parse may still be subtly wrong** (e.g. mirrored axis). Mitigated by the manual spot-check; tolerated at the tail per best-effort.
- **Three generations triple the layout work** — but generation `4` (147 files) alone is worth shipping if the others lag; incremental rollout is the norm here, not the exception.

## 9. Out of scope

- Replicating Incendia's base-shape/volumetric look.
- `ideas/*.par` files (not day-classified).
- Audio, UX, or transition changes.
