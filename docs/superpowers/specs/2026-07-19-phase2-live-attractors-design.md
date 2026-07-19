# Phase 2 — Live Attractor Rendering (Chaoscope Top Families) Design Spec

**Date:** 2026-07-19
**Status:** Approved pending user review
**Depends on:** Phase 1 ("The Living Archive" static constellation), merged to `main` in [gitizenme/365-strange-attractors#1](https://github.com/gitizenme/365-strange-attractors/pull/1)
**Project root:** `/Users/joe/Pictures/Art/365 Strange Attractors/website/`

## 1. Purpose

Extend the piece view (built in Phase 1) so that, for a defined subset of artworks, visitors see the *actual* strange attractor re-rendered live in WebGL from its original 2010 Chaoscope parameter file — a continuously-iterating GPU point cloud alongside the static 2010 render, orbitable, and perturbable via a "disturb" gesture. This is the first of the "live engine" work named in the master design spec's Phase 2 (section 8.2); Incendia IFS support is deliberately deferred to a later phase (see Scope Decision below).

**Success criteria:**
- Every one of the ~51 in-scope works (Chaoscope `lorenz`, `lorenz_84`, `chaotic_flow`, `pickover`, `polynomial_*` families) shows a live, continuously-iterating point cloud in its piece view.
- Disturb gesture visibly perturbs the running simulation and eases back to the authentic parameters.
- Prev/next navigation between two same-family adjacent days morphs via parameter interpolation; every other transition dissolves/re-condenses gracefully.
- Out-of-scope days (remaining Chaoscope families + all Incendia works) are unaffected — Phase 1's static-only piece view continues to work exactly as before.
- Graceful fallback (Phase 1's static piece view) if WebGL2/float-texture support is unavailable, matching the master spec's existing accessibility stance.

## 2. Scope Decision

The master spec bundles "Chaoscope families, then Incendia IFS, disturb, morphs" into one Phase 2. This document scopes down to **Chaoscope only, top 5 families by iteration-formula type**, because:
- Chaoscope's `.csproj` format is fully documented/structured text; Incendia's `.par` format is an undocumented numeric layout (flagged as a named risk in the master spec) that would need reverse-engineering — a separate, riskier effort better isolated into its own future phase.
- Across the archive's `.csproj` files, 13 distinct math families exist. The 5 "top" families (`lorenz`, `lorenz_84`, `chaotic_flow`, `pickover`, `polynomial_func`/`polynomial_c`/`polynomial_a`/`polynomial_b`/`polynomial_sprott`, treated as one `polynomial` family group) are classic, well-understood chaotic-flow/iterated-map systems and, classified per-day, cover **51 of the 365 days** (see Section 3 for the exact per-day breakdown and counting methodology). The remaining 4 Chaoscope families (`icon`, `julia`, `ifs`, `unravel` — 34 days) and all Incendia-only days (280 days) stay static-only for now — same graceful "unparsed"/fallback pattern the master spec already defines, just applied to a larger initial set.

**Adjacency finding (informs Section 5):** across the 365-day sequence, only **6 pairs** of adjacent days share the same top-family type (e.g. days 002→003, both `lorenz_84`). True same-family "morph" transitions are real but rare in normal browsing — most prev/next transitions will be cross-family or family↔static-only, which use the dissolve/re-condense fallback. Design effort is scaled accordingly: dissolve/re-condense is the workhorse path, parameter-interpolation morph is a bonus for the 6 rare cases.

## 3. Source Material

All counts below classify **one day at a time** (each day's primary `.csproj` file, matching how the pipeline and `attractors.json` are organized — one entry per day, consistent with Phase 1's `artworks.json`), not raw file counts across the whole archive (118 total `.csproj` files exist, but some days have more than one, e.g. a duplicate/alternate file).

| Asset | Location | Notes |
|---|---|---|
| Chaoscope params | `project/NNN/*.csproj` | 118 files total across the archive; structured text (`info`/`attractor`/`view`/`gradient` blocks), CRLF line endings |
| In-scope families | `lorenz` (8 days), `lorenz_84` (13), `chaotic_flow` (17), `pickover` (2), `polynomial_func`/`polynomial_c`/`polynomial_a`/`polynomial_b`/`polynomial_sprott` (6+2+1+1+1) | **51 of 365 days**, by per-day primary-family classification |
| Out of scope (this phase) | `icon` (15 days), `julia` (7), `ifs` (7), `unravel` (5) Chaoscope families — **34 days** | Stay static-only; existing Phase 1 piece view unaffected |
| Out of scope (this phase) | Incendia `.par`-only days — **280 days** | No Chaoscope `.csproj` classified as that day's primary file; stays static-only |

(51 + 34 + 280 = 365 — every day accounted for.)

## 4. Architecture

### 4.1 Pipeline addition
A new parser (`pipeline/attractors.mjs`, plain Node — no scientific libraries needed for structured-text parsing) reads all `project/NNN/*.csproj` files, extracts the `type` and the numeric `parameters` array from each `attractor` block, and classifies each day:
- **In-scope** (one of the 5 top families): emits `{day, slug, system, params: number[]}` into `public/data/attractors.json`.
- **Out of scope**: emits `{day, slug, system: "static-only"}` so the app has one canonical place to check "does this day have live data."

`pipeline/build.mjs` is extended to call this parser and merge its output alongside the existing `artworks.json` build step. Idempotent, archive-read-only, following Phase 1's established pipeline conventions.

### 4.2 GPU attractor engine
A GPGPU ping-pong-texture approach (chosen over WebGL2 transform feedback or CPU-precompute — see rationale in the brainstorm; the deciding factor was that continuous GPU-resident iteration is what makes the "disturb" gesture feel like touching a live system rather than triggering a recompute):

- **`src/attractor/gpgpu.ts`** — a `GpgpuAttractor` class managing a ping-pong pair of floating-point position textures, one compute `ShaderMaterial` (advances every point one iteration per frame) and one render `ShaderMaterial` (draws points via `gl_VertexID → texture UV` lookup, additive-blended, palette-tinted from the artwork's `palette[0]`).
- **Point budget tiers**, chosen at runtime from a device-capability heuristic: 512×512 (~256k points, mobile), 1024×1024 (~1M, mid-tier), 2048×2048 (~4M, desktop) — texture-size-driven, matching the master spec's existing tiered-budget language.
- **`src/attractor/families.ts`** — a registry mapping `system` string → `{glslStep, paramCount, seedStrategy}`. Each family's iteration formula lives in its own small file (`src/attractor/families/lorenz.glsl.ts`, `chaoticFlow.glsl.ts`, `pickover.glsl.ts`, `polynomial.glsl.ts`) — small, focused GLSL snippets compiled into the compute shader for that attractor, not one branching mega-shader. Adding a 6th family later is additive.
- **Seeding:** initial point positions randomized (or lightly structured) on load; the compute shader runs a short settling burst (~50–200 iterations over the first few frames, not the original renders' 80M) before the cloud visibly converges onto the attractor manifold and continues flowing.

### 4.3 Piece view integration
`src/piece.ts` is extended: when opening an in-scope day, a `GpgpuAttractor` is constructed and rendered behind/around the static 2010 image in the same canvas (camera pulled back slightly further than Phase 1's flat framing); a UI toggle (matching Phase 1's button pattern) hides the static image for a full-screen live view. Opening an out-of-scope day behaves exactly as in Phase 1 — no live layer, no new UI shown.

Drag-to-orbit reuses Phase 1's `Controls` interaction pattern, extended to 3D orbit around the piece-view camera (Phase 1's controls only handle the flat constellation plane).

### 4.4 Disturb gesture
Press-and-hold on the live cloud ramps a `perturbation` uniform from 0→1 while held (and eases 1→0 over ~1.5s on release) into the compute shader, which nudges one or two of the family's coefficients by `perturbation * smallDelta * noise(pointId)` before iterating each point. Because iteration is continuous, this is purely a uniform change — no separate simulation path. Points visibly drift while held and re-converge to the authentic parsed values on release.

### 4.5 Prev/next transitions
- **Same-family adjacent day** (6 occurrences in the full 365-day sequence): the compute shader's `params` uniform interpolates from the current day's values to the next day's over ~0.8s while the camera holds steady — points visibly flow from one attractor's shape into the other's.
- **Every other transition** (different family, in-scope↔static-only, static-only↔static-only): the current point cloud (if any) fades out while the new day's cloud (if any) seeds and fades in, extending Phase 1's existing static-image crossfade to the point-cloud layer. No cross-family parameter interpolation is attempted.

## 5. Error Handling

- **Parse failure:** a `.csproj` file that fails to parse (or reports a family outside the known 13 types) is recorded as `{system: "static-only"}` — build still succeeds, consistent with the master spec's "unparsed" tolerance.
- **Runtime numerical instability:** if the compute shader produces NaN/Infinity for a point (unstable params for that family), the render pass clamps/skips that point rather than corrupting the whole cloud.
- **WebGL2/float-texture unsupported:** attractor construction fails gracefully; the piece view falls back to Phase 1's static-only rendering for that day, with a console diagnostic — same pattern as the WebGL-fallback fix already shipped in Phase 1's final review.

## 6. Testing

- **Pipeline parser tests:** verified against known files per family (e.g. day 001's parsed params match the raw `.csproj` file's `parameters` block exactly). A numeric sanity test per family: iterate the parsed params ~1000 steps in plain JS (test-only, CPU) and assert the resulting point spread is bounded and non-degenerate — catches a bad parse before it reaches a shader.
- **Completeness test:** every one of the 51 in-scope days has a valid `attractors.json` entry with a recognized `system`; every other day has a `static-only` marker. No silent gaps.
- **Per-family visual verification:** each of the 5 families gets one manual side-by-side check (live render vs. the 2010 reference image) before that family is considered done — matches the master spec's stated testing plan.

## 7. File Structure

- Create: `pipeline/attractors.mjs`
- Modify: `pipeline/build.mjs`
- Create: `src/attractor/gpgpu.ts`, `src/attractor/families.ts`
- Create: `src/attractor/families/{lorenz,lorenz84,chaoticFlow,pickover,polynomial}.glsl.ts`
- Modify: `src/piece.ts` (construct/destroy `GpgpuAttractor` per opened piece, disturb gesture, hide-static toggle)
- Modify: `src/main.ts` (device-tier point budget, morph-vs-dissolve transition logic)

## 8. Phased Delivery (each phase ships)

1. Pipeline: `.csproj` parser + `attractors.json` + tests.
2. GPGPU engine core + **one** family (Lorenz) end-to-end in piece view, no disturb/morph yet — validates the architecture before extending to all 5.
3. Remaining 4 families (`lorenz_84`, `chaotic_flow`, `pickover`, `polynomial`).
4. Disturb gesture.
5. Prev/next morph (same-family) + dissolve (everything else).
6. Device-tier point budgets + mobile/WebGL-unavailable fallback hardening.

## 9. Risks

- **GLSL correctness per family** is easy to get subtly wrong and hard to unit-test meaningfully — mitigated by the mandatory manual visual check per family (Section 6).
- **Mobile GPU/float-texture support** varies; the tiered point budget and WebGL-unavailable fallback (Section 5) are the mitigation, consistent with Phase 1's proven fallback pattern.
- **Rare morph transitions** (only 6 same-family adjacent pairs) mean the parameter-interpolation path gets little real-world exercise — acceptable, since it degrades to the well-tested dissolve/re-condense path everywhere else.
- **Polynomial variant grouping is an assumption, not yet verified.** Section 4.2/7 assumes `polynomial_func`/`polynomial_c`/`polynomial_a`/`polynomial_b`/`polynomial_sprott` share one iteration formula shape (one `polynomial.glsl.ts`). This must be confirmed against the actual `.csproj` parameter blocks for each variant during implementation (Phased Delivery step 3); if a variant's formula genuinely differs, it gets its own small GLSL file under the same registry pattern rather than forcing a shared shape.
- **Incendia IFS** (280 days, per Section 3) remains entirely out of scope for this phase — tracked as a distinct future phase once this engine's architecture is proven and the `.par` format risk can be assessed on its own.
