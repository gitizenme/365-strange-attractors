# Incendia Flow — Live Treatment for Single-Transform Days Design Spec

**Date:** 2026-07-25
**Status:** Approved pending user review
**Prerequisite:** Phase 2c (`2026-07-23-phase2c-incendia-design.md`) — this reuses its `.par` decode and chaos-game engine (the flat-axis correction does NOT transfer — see §4).

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

- `p.transforms.length === 1` → run the new flow-quality gate (`classifyFlow`, below). Pass → `system: 'incendia_flow'`, `matrices: 1`, `params` = `composeIncendiaBlocks` output unchanged (weight forced to `1.0` — nothing to normalize against with one block, and the existing compose function's normalization already produces this for a single positive weight). **Does NOT reuse the flat-axis correction** (`pickFlatAxisSwap`/`swapTransformAxis`) — checked directly during calibration and found it doesn't transfer: that correction's detection method runs one settled chaos-game trajectory from a single start and compares axis spans, which works for a multi-transform *attractor* (a genuine 2D+ spread to compare) but is meaningless for a single-transform *trajectory*, which just converges to one point on every axis simultaneously — the "flattest axis" it reports is driven by floating-point rounding noise, not real structure (directly observed: it flagged a different axis than the transform's actual zero-translation axis). Separately, the flow visual doesn't seem to need it: the halo of not-yet-converged particles (see §5) has genuine off-axis spread even when the fixed point itself sits exactly on a zero-plane — checked directly on a real flat-fixed-point transform, the log-depth sample showed normal 2D spread, not an edge-on line. Status `'live'` (reuses the existing status value — `applyIncendia`'s stats counting stays untouched; the resulting entry's own `system` field already distinguishes `incendia_flow` from `incendia_ifs` for any downstream breakdown). Fail → status `'flow-implausible'`, entry `null`, stays static-only.
- `p.transforms.length >= 2` → unchanged (existing `classify`/plausibility-gate path).
- `p.transforms.length < 1` (shouldn't occur given `p.clean` already required ≥1) → unchanged fallthrough.

**`classifyFlow(transform)` — quality gate, simplified after calibration.** Pre-implementation calibration (2026-07-25, same render-and-inspect methodology as the D/iso gate) checked every one of the 124 real single-transform days' contraction factor (Frobenius-norm scale of the linear part) and found the full population is genuinely contractive: range 0.25–0.9468, median 0.39, **zero** days at or above 0.95 — none are near-identity, none are non-contracting. Rendering the slowest- and fastest-converging real examples at a fixed (non-auto-fit) reference scale confirmed even the fastest-converging case (day 309, scale 0.25 — fully settled within ~5 steps) produces a reasonable continuous-reseed visual: a dense converged core with a sparse halo of freshly-reseeded particles still mid-flight. **Conclusion: no path-length/threshold gate is needed for the real corpus — `classifyFlow` reduces to one defensive guard**, `length(t) === 0` (a transform with no translation has no meaningful fixed point or scale reference to reseed around — degenerate, not observed in the real 124, but a real edge case a `.par` file could theoretically produce). Every one of the 124 real days is expected to pass and go live as `incendia_flow`.

**Methodological note (visualization pitfall found during calibration):** naively rendering a random-start-sample by auto-fitting the display bounds to each sample's own min/max is unsound — for a fast-converging map, the "spread" left after many steps is pure floating-point rounding noise (observed as small as ~1e-10), and auto-fit rescaling stretches that noise to fill the entire frame, making a fully-converged, visually-static case look deceptively lively. Any rendering/estimation done against a **fixed, non-auto-fit reference scale** (tied to the map's own `length(t)`, not to the sample's own min/max) avoids this trap — see §5, which was designed with this finding in mind.

## 5. Display estimation (`src/piece.ts`)

The existing `sampleSettledTrajectory` pattern (settle one long trajectory, sample its tail) doesn't fit — a single-transform trajectory just converges to a point, giving no interesting bounding box from "the tail." `estimateIncendiaFlowDisplay` instead samples **many independent partial trajectories at log-spaced depths**: `N` random starts (proposed `N=200`), each run forward while recording its position at step depths `[1, 2, 4, 8, 16, 32, 64]` (checkpointing the same running trajectory, not restarting it) — not a single fixed depth, and not a uniform-random depth either.

A uniform-random depth range was tried first and found not to work: the real corpus spans contraction factors 0.25–0.9468 (§4), so "still meaningfully converging" happens at wildly different absolute step counts per day — a fixed range that shows genuine motion for the slowest-converging real day (131-glacier, 0.9468) is already fully settled to floating-point-noise for the fastest (309-bow, 0.25) by its lower bound, and vice versa. **Log-spaced depths sidestep this without any per-day contraction-rate estimation**: for any contraction factor in the observed range, `[1..64]` covers from just-perturbed through several e-foldings of convergence — verified directly by rendering the fastest, slowest, and a mid-range real day at these depths; all three show the same qualitative "dense converged core with a diffuse halo of still-converging points" character, none look empty or noise-dominated.

Two further calibration-driven corrections, both required for correct results (found by rendering real days and catching both failure modes directly):

- **Skip depth 0 (the raw seed position).** Recording the untransformed random start pollutes the pool with the seed cube itself, not real attractor structure — this dominated the bounding box in initial testing, swamping out the genuine converged/converging points entirely. (This is why the depth list starts at 1, not 0.)
- **The scale math must use a fixed reference derived from `length(t)`, not an auto-fit min/max of the sample.** Per §4's methodological note, auto-fitting rescales floating-point convergence noise to fill the frame. `sampleSettledTrajectory`'s existing `halfExtent`/`scale` computation *is* auto-fit (min/max of the sampled points) — reusing it unmodified here would silently reintroduce the trap. `estimateIncendiaFlowDisplay` computes its own scale directly from `length(t)`: `TARGET_HALF_EXTENT / (REFERENCE_MULTIPLIER * length(t))`, proposed `REFERENCE_MULTIPLIER = 3` (verified visually against the same three calibration days) — the sampled point pool is used only for the `SeedSpec`, not for deriving scale.

`N` and the depth list `[1,2,4,8,16,32,64]` are starting values, further tunable visually during implementation the same way as `K` in §3 (distinct constants — no relation). (Implemented and shipped unchanged — see the plan's Task 7 verification: all three calibration-range days rendered correctly with these starting values, no retuning needed.)

## 6. UI changes

- `src/piece.ts`'s `FAMILY_LABELS`: add `incendia_flow: 'Incendia flow'`. Also fixes an existing gap noticed along the way — `incendia_ifs` (shipped in phase 2c) was never added to this map either; add `incendia_ifs: 'Incendia IFS'` in the same change, unrelated to this feature but a one-line fix while already touching the file.
- `src/main.ts`'s mode toggle: `orbitBtn.textContent` is currently a hardcoded `'Orbit'`. Add a small accessor on `Piece` (mirroring the existing `isHidingStatic()` pattern, not reaching into internals from `main.ts`) that exposes the open piece's current `system`, and set the button text to `'Flow'` when that system is `incendia_flow`, `'Orbit'` otherwise. `imageBtn`'s label/title stay unchanged either way.

## 7. Morphing

`incendia_flow`↔`incendia_flow` adjacent-day pairs: the existing generic `canMorph` rule (same system + equal `params.length`) would trivially pass for every pair, since every `incendia_flow` entry has `params.length === 13`. Whether that looks *good* — morphing between two different single-transform "drains" — is untested; the existing rule was designed and visually verified for multi-block IFS interpolation, not this. **Decision: default to the existing generic rule (no new code) and visually verify during implementation; if it looks confusing or objectionable, add a system-specific override to force `dissolve` instead.** `incendia_flow`↔`incendia_ifs` and `incendia_flow`↔`ifs` pairs already dissolve unconditionally (different `system`, per the existing rule) — no change needed there.

## 8. Testing

- `classifyFlow`: a real-fixture test (any real single-transform `.par` day — per the calibration finding, all 124 should pass) plus a hand-constructed zero-translation transform confirming the one defensive guard fails as expected (no real corpus example of this exists to use as a fixture).
- A test confirming `buildIncendiaEntry`'s single-transform branch does *not* call `pickFlatAxisSwap`/`swapTransformAxis` (regression guard for the §4 finding — those functions don't produce meaningful results for a single-transform trajectory).
- Engine: a test that `randomReseedChance` is `undefined`/unset for every existing family (regression guard — nothing else should get this behavior by accident), and that `computeShader`'s generated GLSL only includes the reseed-chance branch when a family sets it.
- `estimateIncendiaFlowDisplay`: CPU-side tests mirroring the existing `estimate*Display` test pattern (finite positive scale, non-empty seed pool, all-finite points).
- `tests/attractors-completeness.test.mjs`'s matrices-consistency check (added in phase 2c) currently filters on `a.system !== 'incendia_ifs'` specifically — extend it to also cover `incendia_flow` (both encode `matrices`/`params.length` the same way, so the same assertion applies unchanged, just needs the filter widened).
- Full regression suite green at every step (established project norm).
- Visual spot-check once implemented: browser-verify a sample of `incendia_flow` days spanning the observed contraction range (fastest ~0.25, slowest ~0.9468, and a mid-range day) — confirm continuous motion, no visible NaN pileup or flicker, reasonable default framing. Include at least one day with a zero-translation-component axis (e.g. day 236) to confirm the halo genuinely provides enough off-axis spread without the flat-axis correction, per §4's finding.

## 9. Out of scope

- Replicating Incendia's actual base-shape/volumetric rendering (per the master-spec rendering stance, reaffirmed in §1) — this feature is a different, new living-skeleton-consistent visual, not a shape-matching replica.
- The 4 non-contiguous `.par` parse failures and the plausibility-gate refinement for the 51 multi-transform "implausible" days (phase 2c's `classify()` gate) — separately tracked, [GitHub issue #24](https://github.com/gitizenme/365-strange-attractors/issues/24).
- Any change to the phase-2c `incendia_ifs`/`ifs` gate, engine, or pipeline logic beyond the two additive, opt-in changes in §3 (`randomReseedChance` defaulting off) and §4 (a new branch that only fires for `transforms.length === 1`, previously dead code).

## 10. Decisions made

- **Approach:** live convergence/divergence particle field (reusing the existing GPGPU chaos-game engine almost unchanged), over a 2D image-warp shader on the static photo or a single animated spiral-trace. Chosen for consistency — "Orbit" keeps meaning the same thing (a live, draggable 3D particle cloud) everywhere on the site, just with honest different dynamics for this subset, and it's the largest reuse of already-built, battle-tested code.
- **UI label:** `incendia_flow` days show "Flow" instead of "Orbit" on the mode-toggle button, signaling the different dynamics before the user clicks in, at the cost of one small conditional in `main.ts`.
- **Quality gate methodology:** empirical simulate-and-measure, consistent with how `classify()` already works for the multi-transform gate — not closed-form eigenvalue analysis, deliberately, matching the codebase's established preference for empirical over analytic approaches to these questions.
- **Gate outcome:** calibration found the real corpus needs no exclusion threshold at all — every one of the 124 single-transform days is genuinely contractive (0.25–0.9468, none near-identity) and every one produces a reasonable live visual at a fixed reference scale. `classifyFlow` ships as a single defensive guard (zero-translation) rather than a tuned threshold, since there was nothing real to tune against.
