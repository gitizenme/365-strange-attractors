# Phase 2b — Chaoscope Completion Design Spec

**Date:** 2026-07-23
**Status:** Approved pending user review
**Predecessor:** `2026-07-19-phase2-live-attractors-design.md` (shipped: 51 live days across 5 top families)
**Companion:** `2026-07-23-phase2c-incendia-design.md` (builds on this spec's chaos-game core; implemented after this spec ships)

## 1. Purpose

Extend the live Orbit view to the 34 remaining Chaoscope days — the 4 families deferred by Phase 2's scope decision: `icon` (15 days), `julia` (7), `ifs` (7), `unravel` (5). After this phase, live-Orbit coverage goes **51 → 85 days**; the other 280 (Incendia-only) days are Phase 2c's territory.

This phase also deliberately builds the **generic chaos-game IFS capability** that Phase 2c will reuse — proving it against Chaoscope's documented `.csproj` format (reliable ground truth) before betting on Incendia's undocumented `.par` format.

**Success criteria:**
- All 34 days show the Image|Orbit toggle and render a live point cloud faithful in character to their 2010 render (per-family visual verification, same bar as Phase 2).
- Zero regression on the 51 shipped days and the 280 static-only days.
- The chaos-game engine addition is family-agnostic: Phase 2c consumes it by adding a family definition and parser only.
- Best-effort tolerance applies to hard cases (notably `unravel` if its iteration formula proves unrecoverable, and `julia` as the highest-risk family) — a family that resists stays static-only rather than blocking the rest.

## 2. Verified source material

Counts from `public/data/attractors.json` (shipped Phase 2 pipeline): 314 static-only, of which 34 have in-archive `.csproj` files in these families. Sample attractor blocks verified in the archive:

| Family | Days | Sample | Params | Notes |
|---|---|---|---|---|
| `icon` | 15 | `project/004/004_Triangular_Curves.csproj` | 6 (`<3, 0.082, 2.688, -1.455, 0.29, -0.004>`) | Field–Golubitsky symmetric icon; 2D iterated map |
| `julia` | 7 | `project/011/011_Sphere.csproj` | 4 (`<10, 0.0519…, 0.0519…, 3.14159…>`) | Quaternion Julia; escape-time set, not a forward attractor |
| `ifs` | 7 | `project/011/011_Monday.csproj` | `matrices N` + N×16 floats | Last float of each 16-block is a weight; day 011's weights sum ≈ 1.0. The `exclude` list (`<15, 31, 47, …>` — every 16th index) corroborates the weight positions |
| `unravel` | 5 | `project/017/017_Marble_1536x1536.csproj` | 7 | Chaoscope-specific system; formula from Chaoscope documentation |

## 3. Engine change: the chaos-game capability

The only real engine work. Today's `AttractorFamily` contract (`src/attractor/gpgpu.ts`) is a deterministic `stepAttractor(p, params)` — every particle applies the same function each step. Weighted-IFS chaos game needs each particle to pick a random transform each step. Two generic additions:

1. **Per-particle, per-frame randomness.** A hash-based GLSL RNG seeded from particle UV plus a new per-frame counter uniform (`uFrame`), added to the compute-shader scaffold in `gpgpu.ts`. The NaN-rescue path already uses the same `fract(sin(dot(...)))` hash idiom; this formalizes it into a reusable function available to family step bodies.
2. **Per-instance parameter length.** `paramCount` is currently fixed per family, but `ifs` days vary (e.g. 8 matrices × 16 floats). Since the compute shader is compiled per-`LiveAttractor` instantiation, `paramCount` becomes an instance value derived from `params.length`, with the family declaring a *stride* (e.g. 16) instead of a fixed count where applicable. Backwards-compatible: existing families keep their fixed counts.

With both in place, the chaos-game family step is: hash → cumulative-weight transform selection → apply affine transform. No changes to render shaders, tiers, palette, calibration, or the disturb/morph plumbing.

**Morph note:** same-family morphs interpolate `uParamsA→uParamsB` elementwise. For `ifs` days this is only valid when both days have the same matrix count; `transitionKind` gains that guard (different counts → dissolve). All cross-family and static transitions dissolve, as today.

## 4. The four families, in build order (confidence-descending)

1. **`ifs`** — the chaos-game core itself, verified against the 7 documented Chaoscope days. Exact interpretation of the 15 non-weight floats per matrix confirmed against Chaoscope's project-file documentation during implementation (candidate reading: 3D affine — 3×3 matrix + translation — plus per-transform extras; whatever the docs say wins).
2. **`icon`** — documented 2D symmetric-icon map (degree + 5 coefficients); fits the existing discrete-map pattern exactly (like `pickover`). Planar result rendered in 3D space, matching how Chaoscope itself displays it; orbit drag remains meaningful.
3. **`unravel`** — 7-param Chaoscope-specific system; iteration formula from Chaoscope's documentation. If genuinely unrecoverable, these 5 days stay static-only (tolerated).
4. **`julia`** — rendered by **inverse iteration**: from a random start, repeatedly apply a randomly chosen inverse branch of `z → z^n + c` (quaternion form per Chaoscope's 4 params: power, c-components, slice angle); converges onto the Julia set boundary. Structurally a chaos game, so it reuses the same RNG machinery with a family-specific step. Highest risk; scheduled last so it cannot block the other 27 days.

**Disturb indices per family:** `icon`/`unravel` — the obvious shape coefficients; `ifs` — matrix translation components (visually legible, structurally safe); `julia` — the `c` components.

## 5. Data flow and integration

- `pipeline`: `IN_SCOPE_FAMILIES` grows 9 → 13 type strings. `buildAttractors` re-emits `attractors.json` with params for the 34 days (the parser already reads these files; it currently classifies them out of scope). For `ifs`, the emitted entry carries `matrices` so the app can derive stride/count without re-parsing.
- Everything downstream is data-driven and needs **no app changes**: family caption line, Image|Orbit toggle visibility, brightness slider, disturb gesture, and morph detection light up automatically. A few new same-family adjacent pairs (e.g. adjacent `icon` days) automatically become morphs.
- Completeness test expectations update: 85 live / 280 static-only.

## 6. Error handling

All existing and inherited unchanged: NaN/escape rescue reseeds particles in-shader; WebGL2-unavailable falls back to the static piece view; a family that fails visual verification ships as static-only (its type string simply stays out of `IN_SCOPE_FAMILIES` at merge time). No new error surfaces.

## 7. Testing

Same regimen as Phase 2:
- **RED→GREEN parser tests** per family: known `.csproj` → exact expected params (day 004 icon, day 011 julia + ifs, day 017 unravel).
- **Completeness test**: every day either live-with-params or static-only; counts assert 85/280.
- **Smoke test per family**: step function produces non-degenerate spread (existing harness).
- **Chaos-game determinism test**: with a stubbed frame counter, transform selection matches CPU reference for a known weight vector.
- **Per-family visual verification** against 2010 renders (manual, once per family — the Phase 2 bar).
- Full regression suite green at every task boundary.

## 8. Out of scope

- Incendia `.par` days (280) — Phase 2c.
- Any visual/UX changes to the piece view, transitions, or audio.
