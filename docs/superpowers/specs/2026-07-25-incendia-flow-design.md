# Incendia Flow — Live Treatment for Single-Transform Days Design Spec

**Date:** 2026-07-25
**Status:** Approved pending user review
**Prerequisite:** Phase 2c (`2026-07-23-phase2c-incendia-design.md`) — this reuses its `.par` decode, chaos-game engine, and flat-axis correction.

## 1. Purpose

Phase 2c brought live Orbit to 186 of 365 days. Of the remaining 179 static-only days, 124 have exactly one Incendia transform in their `.par` file. A single affine map has no chaos-game attractor structure to show — mathematically it's just a fixed point — so phase 2c correctly left these static-only. This phase gives those 124 days a different kind of live treatment: not a settled attractor, but the honest transient dynamics of repeatedly applying that one real transform — particles flowing toward (or away from) its fixed point.

**Rendering stance (unchanged, reaffirmed):** the master spec's stance — "point clouds are the attractor's living skeleton, not a replica of Incendia's volumetric/base-shape rendering" — still holds. Investigation during brainstorming confirmed these days' "base shapes" are Incendia's own raymarched isosurfaces with real materials/lighting (smooth knotted sculptures, spiky urchins, layered ribbons — see day 116, 130, 096, 119 in `generated/`), not simple primitives; replicating them is out of scope and would contradict the site's founding design decision. This phase does **not** attempt that. It gives these days a *different* live thing to look at — flow, not shape-matching.

**Success bar:** every single-transform day whose map produces visible motion (not near-identity) gets a live `incendia_flow` entry. A day whose map barely moves particles at all stays static-only — same graceful-fallback pattern as phase 2c's plausibility gate, just for a different failure mode ("boring," not "not fractal").

## 2. Core mechanic

Every GPU particle applies the day's single transform `v' = Mv + t` every frame — no random transform selection (there's only one block, so cumulative-weight selection trivially always picks it; the existing `ifs`/`incendia_ifs` `stepAttractor` GLSL works unchanged).

Two dynamical outcomes, both left to emerge honestly from the real matrix — never faked or special-cased by outcome:

- **Contractive** (particles net move toward a fixed point): left alone, every particle eventually converges to the exact same point and the cloud goes static. A new per-frame, per-particle random chance of respawning at a fresh position (`randomReseedChance`, see §3) keeps the field alive indefinitely — particles perpetually born, flowing/spiraling inward, then reborn. Spiral tightness and rotation come from the map's own eigenstructure (real eigenvalues → direct flow; complex eigenvalues → rotation), so each day looks genuinely different.
- **Non-contractive** (particles net move away from any fixed point): already handled for free by the existing NaN/overflow rescue in `gpgpu.ts`'s `computeShader` (any particle exceeding `1e4` or going NaN is already reset to a fresh random position every frame, for every family). No new logic needed for this case — it'll look like particles spraying outward and being continuously reborn, which is if anything more visually active than the contractive case.

## 3. Engine changes (`src/attractor/gpgpu.ts`)

One new optional `AttractorFamily` field:

```ts
/** Per-step probability [0,1] a particle respawns at a fresh random position, independent of
 * the existing NaN/divergence rescue. Unset/0 for every family except incendia_flow — gives a
 * contractive single-transform map continuous turnover instead of collapsing to a static point. */
randomReseedChance?: number;
```

Wired into `computeShader()`'s existing reset branch: the generated GLSL already has a "produce a fresh random position" code path (the `rx`/`ry`/`rz` hash lines) that fires today only on NaN/overflow. Add a second trigger condition — `cgRand(uv, uFrame * 7.0 + 3.0) < uReseedChance` (a distinct hash offset from the position step's own `cgRand` call, so the reseed draw doesn't correlate with per-step transform behavior) — reusing the exact same reset code, not duplicating it. New uniform `uReseedChance`, set once at `LiveAttractor` construction from `family.randomReseedChance ?? 0`. Every existing family leaves this at 0 — zero behavior change.

**Reseed position:** a random point in a cube of half-width `K * length(t)` centered at the local-space origin, where `t` is the transform's own translation (already present in the shader's `params` array — no new uniform needed) and `K` is a tunable constant. `length(t)` is a natural, always-available, per-day scale proxy (the map's fixed point and its translation are related; a map that moves things a lot per step has proportionally large `t`). **Starting value `K = 15`, to be tuned visually during implementation** — same empirical-calibration precedent as phase 2c's D/iso thresholds (that spec didn't hardcode them upfront either; they came from the Phase 0 spike). If a day's reseed radius looks wrong (particles spawn too close to already look "arrived," or too far to ever visibly connect to the fixed point), `K` is the one knob to retune.

## 4. Pipeline changes (`pipeline/incendia.mjs`)

`buildIncendiaEntry` currently short-circuits single-transform days: `if (p.transforms.length < 2) return { gen: p.gen, status: 'single-transform', entry: null }`. Replace with a new branch:

- `p.transforms.length === 1` → run the new flow-quality gate (`classifyFlow`, below). Pass → `system: 'incendia_flow'`, `matrices: 1`, `params` = `composeIncendiaBlocks` output unchanged (weight forced to `1.0` — nothing to normalize against with one block, and the existing compose function's normalization already produces this for a single positive weight). Reuses the flat-axis correction unchanged: `pickFlatAxisSwap`/`swapTransformAxis` already operate generically on any-length transform arrays and degrade correctly for length 1 — apply it here too, same as `incendia_ifs`. Status `'live'` (reuses the existing status value — `applyIncendia`'s stats counting stays untouched; the resulting entry's own `system` field already distinguishes `incendia_flow` from `incendia_ifs` for any downstream breakdown). Fail → status `'flow-implausible'`, entry `null`, stays static-only.
- `p.transforms.length >= 2` → unchanged (existing `classify`/plausibility-gate path).
- `p.transforms.length < 1` (shouldn't occur given `p.clean` already required ≥1) → unchanged fallthrough.

**`classifyFlow(transform)` — the new quality gate.** Simulates ~2000 steps of the single transform from a random start (same style as `classify`'s chaos-game simulation — empirical, not closed-form eigenvalue math, matching the codebase's existing pattern) and measures **total path length traveled** (sum of per-step displacement magnitudes) relative to `length(t)` as a natural scale unit. A map that's near-identity (barely moves each step) or converges in 1-2 steps racks up negligible total path length relative to its own translation scale; a map producing a visible multi-step spiral-in, or sustained divergent motion, accumulates much more. **Threshold to be calibrated empirically during implementation** (render a sample of the 124 days at varying path-length ratios, same visual-inspection process used for the D/iso band in phase 2c) — not a placeholder, an explicit calibration step with a concrete methodology already specified.

## 5. Display estimation (`src/piece.ts`)

The existing `sampleSettledTrajectory` pattern (settle one long trajectory, sample its tail) doesn't fit — a single-transform trajectory just converges to a point, giving no interesting bounding box from "the tail." `estimateIncendiaFlowDisplay` instead samples **many independent partial trajectories**: `N` random starts (proposed starting point `N=200`), each run for `M` steps (proposed starting point `M=30`, deliberately *not* fully settled — the point is to capture the flow-in-progress, not the endpoint), collecting every intermediate point from every run into one pool. That pool feeds the same `halfExtent`/`scale`/`center` bounding-box math `sampleSettledTrajectory` already uses, and doubles as the `SeedSpec` point pool for `LiveAttractor`'s initial GPU texture fill. `N`/`M` are starting values, tuned during implementation the same way as `K` in §3 (a distinct constant from that one — no relation).

## 6. UI changes

- `src/piece.ts`'s `FAMILY_LABELS`: add `incendia_flow: 'Incendia flow'`. Also fixes an existing gap noticed along the way — `incendia_ifs` (shipped in phase 2c) was never added to this map either; add `incendia_ifs: 'Incendia IFS'` in the same change, unrelated to this feature but a one-line fix while already touching the file.
- `src/main.ts`'s mode toggle: `orbitBtn.textContent` is currently a hardcoded `'Orbit'`. Add a small accessor on `Piece` (mirroring the existing `isHidingStatic()` pattern, not reaching into internals from `main.ts`) that exposes the open piece's current `system`, and set the button text to `'Flow'` when that system is `incendia_flow`, `'Orbit'` otherwise. `imageBtn`'s label/title stay unchanged either way.

## 7. Morphing

`incendia_flow`↔`incendia_flow` adjacent-day pairs: the existing generic `canMorph` rule (same system + equal `params.length`) would trivially pass for every pair, since every `incendia_flow` entry has `params.length === 13`. Whether that looks *good* — morphing between two different single-transform "drains" — is untested; the existing rule was designed and visually verified for multi-block IFS interpolation, not this. **Decision: default to the existing generic rule (no new code) and visually verify during implementation; if it looks confusing or objectionable, add a system-specific override to force `dissolve` instead.** `incendia_flow`↔`incendia_ifs` and `incendia_flow`↔`ifs` pairs already dissolve unconditionally (different `system`, per the existing rule) — no change needed there.

## 8. Testing

- `classifyFlow`: real-fixture tests using actual single-transform `.par` days from the corpus — at least one that should pass (visibly spirals/flows) and one that should fail (near-identity, boring), identified by rendering a sample during implementation (mirrors phase 2c's Task-1 fixture process).
- `pickFlatAxisSwap`/`swapTransformAxis` reuse: a regression test confirming these apply correctly to a length-1 transform array (no new logic, just confirming the existing generic functions degrade correctly).
- Engine: a test that `randomReseedChance` is `undefined`/unset for every existing family (regression guard — nothing else should get this behavior by accident), and that `computeShader`'s generated GLSL only includes the reseed-chance branch when a family sets it.
- `estimateIncendiaFlowDisplay`: CPU-side tests mirroring the existing `estimate*Display` test pattern (finite positive scale, non-empty seed pool, all-finite points).
- `tests/attractors-completeness.test.mjs`'s matrices-consistency check (added in phase 2c) currently filters on `a.system !== 'incendia_ifs'` specifically — extend it to also cover `incendia_flow` (both encode `matrices`/`params.length` the same way, so the same assertion applies unchanged, just needs the filter widened).
- Full regression suite green at every step (established project norm).
- Visual spot-check once implemented: browser-verify a sample of `incendia_flow` days across contractive/divergent/rotating-vs-direct cases — confirm continuous motion, no visible NaN pileup or flicker, reasonable default framing (reusing phase 2c's flat-axis correction should already prevent the edge-on-line problem here too, but worth confirming on at least one real flat single-transform day if one exists in the accepted set).

## 9. Out of scope

- Replicating Incendia's actual base-shape/volumetric rendering (per the master-spec rendering stance, reaffirmed in §1) — this feature is a different, new living-skeleton-consistent visual, not a shape-matching replica.
- The 4 non-contiguous `.par` parse failures and the plausibility-gate refinement for the 51 multi-transform "implausible" days (phase 2c's `classify()` gate) — separately tracked, [GitHub issue #24](https://github.com/gitizenme/365-strange-attractors/issues/24).
- Any change to the phase-2c `incendia_ifs`/`ifs` gate, engine, or pipeline logic beyond the two additive, opt-in changes in §3 (`randomReseedChance` defaulting off) and §4 (a new branch that only fires for `transforms.length === 1`, previously dead code).

## 10. Decisions made

- **Approach:** live convergence/divergence particle field (reusing the existing GPGPU chaos-game engine almost unchanged), over a 2D image-warp shader on the static photo or a single animated spiral-trace. Chosen for consistency — "Orbit" keeps meaning the same thing (a live, draggable 3D particle cloud) everywhere on the site, just with honest different dynamics for this subset, and it's the largest reuse of already-built, battle-tested code.
- **UI label:** `incendia_flow` days show "Flow" instead of "Orbit" on the mode-toggle button, signaling the different dynamics before the user clicks in, at the cost of one small conditional in `main.ts`.
- **Quality gate methodology:** empirical simulate-and-measure (total path length relative to translation scale), consistent with how `classify()` already works for the multi-transform gate — not closed-form eigenvalue analysis, deliberately, matching the codebase's established preference for empirical over analytic approaches to these questions.
