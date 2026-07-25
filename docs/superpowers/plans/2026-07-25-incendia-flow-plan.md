# Incendia Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 124 single-transform Incendia `.par` days a live "Flow" treatment — particles continuously flowing toward (or away from) the day's real fixed point — instead of leaving them static-only forever.

**Architecture:** Every GPU particle applies the day's one real transform every frame (the existing `ifs`/`incendia_ifs` chaos-game shader already does this correctly for a single block — no new GLSL step needed), plus a new opt-in per-frame reseed probability so a contractive map's particles don't all collapse to one static point. Pipeline emits `system: 'incendia_flow'` entries; a new `AttractorFamily` reuses `IFS`'s runtime wholesale; a new CPU display estimator replaces the "settle one trajectory" pattern (meaningless for a single fixed point) with log-depth-sampled multi-trajectory snapshots at a fixed, non-auto-fit reference scale.

**Tech Stack:** TypeScript (Vite, Three.js GPUComputationRenderer) for the client; plain Node.js ESM for the pipeline; Vitest for tests.

## Global Constraints

- No placeholder/TBD values — every numeric constant below (`randomReseed.chance = 0.003`, `randomReseed.radiusMultiplier = 15`, estimator's `N = 200`, depths `[1,2,4,8,16,32,64]`, `REFERENCE_MULTIPLIER = 3`) was derived from real calibration against the actual 124-day corpus (see `docs/superpowers/specs/2026-07-25-incendia-flow-design.md`, §3–§5) — not guesses. They may still be visually retuned during Task 7's browser spot-check; if so, update this plan's Task 7 notes with the final values.
- Every existing family (`lorenz`, `ifs`, `incendia_ifs`, etc.) must show **zero** behavior change — the engine change (Task 1) is purely additive and opt-in per family.
- `pickFlatAxisSwap`/`swapTransformAxis` (phase 2c) must **not** be applied to `incendia_flow` entries — confirmed during spec calibration that the detection method produces noise-driven, meaningless results for a single-transform trajectory (see spec §4).
- `applyIncendia`'s per-generation stats counting (`pipeline/incendia.mjs`) must not change shape — `incendia_flow` entries reuse the existing `'live'` status value, distinguished afterward only by their own `system` field.
- Full regression suite (`npx vitest run`) and `npx tsc --noEmit` green after every task.

---

### Task 1: Engine — opt-in particle reseed

**Files:**
- Modify: `src/attractor/gpgpu.ts:5-20` (the `AttractorFamily` interface), `src/attractor/gpgpu.ts:54-101` (`computeShader`)
- Test: `tests/gpgpu.test.ts` (append to the existing `describe('computeShader scaffold (phase 2b)', ...)` block, after the `stateW` test ending at line 122)

**Interfaces:**
- Produces: `AttractorFamily.randomReseed?: { chance: number; radiusMultiplier: number }`. When set, `computeShader()`'s generated GLSL gains an additional reset branch (independent of the existing NaN/divergence rescue) that fires with probability `chance` per particle per frame, respawning the particle at a random position in a cube of half-width `radiusMultiplier * length(t)` (where `t` is read from `params[9..11]` — the translation of the shader's own single 13-float block — at shader-compile time this is baked as GLSL source referencing the runtime `params[]` array, not a JS-side computation). When unset, the generated GLSL is byte-identical to today's output for that family.

- [ ] **Step 1: Write the failing tests** — append to `tests/gpgpu.test.ts`, inside the existing `describe('computeShader scaffold (phase 2b)', ...)` block (after the last `it(...)` block, before the closing `});` at line 123):

```ts
  it('adds no reseed branch when randomReseed is unset (every existing family)', () => {
    const src = computeShader(fixed, 4);
    expect(src).not.toContain('reseedRadius');
  });
  it('bakes chance and radiusMultiplier as GLSL float literals when randomReseed is set', () => {
    const withReseed: AttractorFamily = {
      system: 'r', paramCount: 13, isDiscreteMap: true,
      randomReseed: { chance: 0.003, radiusMultiplier: 15 },
      glslStep: `vec3 stepAttractor(vec3 p, float params[13]) { return p; }`,
    };
    const src = computeShader(withReseed, 13);
    expect(src).toContain('cgRand(uv, uFrame * 7.0 + 3.0) < 0.003000');
    expect(src).toContain('15.000000 * length(vec3(params[9], params[10], params[11]))');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/gpgpu.test.ts`
Expected: the first new test passes trivially (nothing to fail yet), the second FAILS — `src` won't contain the expected strings since `randomReseed` doesn't exist on the type yet (TypeScript compile error) and `computeShader` doesn't emit that GLSL. You'll actually see a TypeScript error first (`Object literal may only specify known properties, and 'randomReseed' does not exist in type 'AttractorFamily'`) — that's the expected RED state; proceed to Step 3.

- [ ] **Step 3: Implement** — in `src/attractor/gpgpu.ts`:

Replace the `AttractorFamily` interface (lines 5-20):

```ts
export interface AttractorFamily {
  system: string;
  /** Fixed param count, or 'variable' — the instance's params.length is used and `__N__` in glslStep is substituted with it. */
  paramCount: number | 'variable';
  /** GLSL function body: `vec3 stepAttractor(vec3 p, float params[N])` — or vec4-in/vec4-out when stateW is true.
   * May use the scaffold's `cgUv` (this particle's uv), `uFrame` uniform, and `cgRand(vec2, float)`. */
  glslStep: string;
  /** true for discrete maps (pickover, polynomial_*, and all phase-2b families); false for ODEs integrated with a trailing dt param. */
  isDiscreteMap: boolean;
  /** indices into params[] that the disturb gesture perturbs (fixed-count families). */
  disturbIndices?: number[];
  /** stride-repeated disturb targets for variable-count families: every block of `stride` params gets `offsets` perturbed. */
  disturbStride?: { stride: number; offsets: number[] };
  /** step signature is vec4→vec4 and the texture's alpha channel persists the 4th state component (julia's quaternion k). */
  stateW?: boolean;
  /** Per-step probability [0,1] a particle respawns at a fresh random position, independent of
   * the existing NaN/divergence rescue -- unset for every family except incendia_flow, which
   * uses it so a contractive single-transform map gets continuous turnover instead of collapsing
   * to a static point (see families/incendia.ts). radiusMultiplier scales the reseed cube's
   * half-width as a multiple of length(t), the step's own translation -- read directly from the
   * params array at runtime, no new uniform needed. Baked as GLSL literals at shader-compile
   * time (computeShader is called once per LiveAttractor construction), not a runtime uniform. */
  randomReseed?: { chance: number; radiusMultiplier: number };
}
```

Replace `computeShader` (lines 54-101):

```ts
export function computeShader(family: AttractorFamily, paramCount: number): string {
  let disturbLines: string[];
  if (family.disturbStride) {
    const { stride, offsets } = family.disturbStride;
    disturbLines = [];
    for (let b = 0; b * stride < paramCount; b++) {
      for (const o of offsets) disturbLines.push(DISTURB_LINE(b * stride + o));
    }
  } else {
    disturbLines = (family.disturbIndices ?? []).map(DISTURB_LINE);
  }
  const step = family.glslStep.replaceAll('__N__', String(paramCount));
  const w = family.stateW === true;
  const reseed = family.randomReseed;
  return /* glsl */ `
    uniform float uParamsA[${paramCount}];
    uniform float uParamsB[${paramCount}];
    uniform float uMorphMix;
    uniform float uPerturbation;
    uniform float uFrame;
    vec2 cgUv;
    float cgRand(vec2 uv, float n) {
      return fract(sin(dot(vec3(uv, mod(n, 1024.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    }
    ${step}
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      cgUv = uv;
      vec4 tex = texture2D(texturePosition, uv);
      ${w ? 'vec4 p = tex;' : 'vec3 p = tex.xyz;'}
      float params[${paramCount}];
      for (int i = 0; i < ${paramCount}; i++) {
        params[i] = mix(uParamsA[i], uParamsB[i], uMorphMix);
      }
      ${disturbLines.join('\n      ')}
      ${w ? 'vec4 next4 = stepAttractor(p, params);\n      vec3 next = next4.xyz;' : 'vec3 next = stepAttractor(p, params);'}
      if (!(next.x == next.x) || !(next.y == next.y) || !(next.z == next.z) ||
          ${w ? '!(next4.w == next4.w) ||' : ''}
          abs(next.x) > 1.0e4 || abs(next.y) > 1.0e4 || abs(next.z) > 1.0e4) {
        float rx = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        float ry = fract(sin(dot(uv, vec2(93.9898, 67.345))) * 24634.6345) - 0.5;
        float rz = fract(sin(dot(uv, vec2(41.2398, 289.123))) * 12345.6789) - 0.5;
        gl_FragColor = vec4(rx, ry, rz, ${w ? '0.0' : '1.0'});
        return;
      }
      ${reseed ? `
      if (cgRand(uv, uFrame * 7.0 + 3.0) < ${reseed.chance.toFixed(6)}) {
        float reseedRadius = ${reseed.radiusMultiplier.toFixed(6)} * length(vec3(params[9], params[10], params[11]));
        float rx2 = (fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 2.0 * reseedRadius;
        float ry2 = (fract(sin(dot(uv, vec2(93.9898, 67.345))) * 24634.6345) - 0.5) * 2.0 * reseedRadius;
        float rz2 = (fract(sin(dot(uv, vec2(41.2398, 289.123))) * 12345.6789) - 0.5) * 2.0 * reseedRadius;
        gl_FragColor = vec4(rx2, ry2, rz2, 1.0);
        return;
      }` : ''}
      gl_FragColor = ${w ? 'vec4(next, next4.w)' : 'vec4(next, 1.0)'};
    }
  `;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/gpgpu.test.ts`
Expected: all tests pass, including both new ones.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, no type errors.

```bash
git add src/attractor/gpgpu.ts tests/gpgpu.test.ts
git commit -m "feat(incendia-flow): opt-in particle reseed for AttractorFamily

New optional AttractorFamily.randomReseed field, wired into
computeShader's existing reset branch (a second, independent trigger
alongside the NaN/divergence rescue). Baked as GLSL literals at
shader-compile time -- no new uniform. Unset for every existing
family, zero behavior change."
```

---

### Task 2: Pipeline — `classifyFlow` quality gate

**Files:**
- Modify: `pipeline/incendia.mjs` (append after `swapTransformAxis`, before the `// ---------- pipeline entry points ----------` comment currently at line 261)
- Test: `tests/incendia.test.mjs` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `classifyFlow(transform: {m: number[][], t: number[], w: number}): { plausible: boolean, reason?: string }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/incendia.test.mjs`, after the last `describe` block (the flat-axis one added in phase 2c):

```js
// Real project/236/236_Wheel_in_the_Sky.par -- gen "6 1", 1 transform (pure uniform 0.432713
// scale, translation [-0.053282, 0, 1.848541] -- Y component exactly zero, same pattern as day
// 105's incendia_ifs transforms). Real regression fixture for the single-transform ("Incendia
// Flow") pipeline path.
const WHEEL_IN_THE_SKY = crlf([
  ...HEADER('6 1', 1),
  '0.432713 0.000000 0.000000 0.000000',
  '0.432713 0.000000 0.000000 0.000000',
  '0.432713 -0.053282 0.000000 1.848541',
  '1.000000',
]);

describe('classifyFlow', () => {
  it('accepts a real single-transform day (236, pure 0.432713x scale)', () => {
    const { transforms } = parsePar(WHEEL_IN_THE_SKY);
    expect(classifyFlow(transforms[0]).plausible).toBe(true);
  });
  it('rejects a hand-constructed zero-translation transform (no fixed point to reseed around)', () => {
    const transform = { m: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], t: [0, 0, 0], w: 1 };
    const result = classifyFlow(transform);
    expect(result.plausible).toBe(false);
    expect(result.reason).toBe('zero-translation');
  });
});
```

Also add `classifyFlow` to the existing import statement at the top of the file:

```js
import {
  parsePar, composeIncendiaBlocks, chaosGame, classify, classifyLiveParams,
  pickFlatAxisSwap, swapTransformAxis, classifyFlow, buildIncendiaEntry, applyIncendia,
} from '../pipeline/incendia.mjs';
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/incendia.test.mjs`
Expected: FAIL — `classifyFlow is not a function` (or `undefined`), since it doesn't exist yet.

- [ ] **Step 3: Implement** — in `pipeline/incendia.mjs`, insert after `swapTransformAxis`'s closing `}` (currently line 259) and before the `// ---------- pipeline entry points ----------` comment (currently line 261):

```js
// ---------- single-transform ("Incendia Flow") quality gate ----------
// Calibration (2026-07-25, see docs/superpowers/specs/2026-07-25-incendia-flow-design.md) checked
// every one of the 124 real single-transform days' contraction factor (Frobenius-norm scale of
// the linear part) and found the whole population genuinely contractive: range 0.25-0.9468,
// median 0.39, zero days at or above 0.95 -- none are near-identity, none are non-contracting.
// There is no real threshold to calibrate: every one of the 124 real days is expected to pass.
// The one defensive guard is a transform with zero translation, which has no meaningful fixed
// point or scale reference to reseed around (not observed in the real corpus, but a `.par` file
// could in principle produce one).
export function classifyFlow(transform) {
  const tLen = Math.hypot(transform.t[0], transform.t[1], transform.t[2]);
  if (tLen === 0) return { plausible: false, reason: 'zero-translation' };
  return { plausible: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/incendia.test.mjs`
Expected: PASS, both new tests plus all existing ones in the file.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

```bash
git add pipeline/incendia.mjs tests/incendia.test.mjs
git commit -m "feat(incendia-flow): classifyFlow quality gate

Calibration found the real 124-day single-transform corpus needs no
tuned threshold -- every day is genuinely contractive (0.25-0.9468).
classifyFlow ships as a single defensive guard (zero-translation)."
```

---

### Task 3: Pipeline — wire single-transform days into `buildIncendiaEntry`

**Files:**
- Modify: `pipeline/incendia.mjs:266-280` (`buildIncendiaEntry`)
- Test: `tests/incendia.test.mjs` (append)

**Interfaces:**
- Consumes: `classifyFlow` (Task 2), `composeIncendiaBlocks`, `pickAttractorFile`, `parsePar` (all existing).
- Produces: `buildIncendiaEntry` now returns `{ gen, status: 'live', entry: { day, slug, system: 'incendia_flow', matrices: 1, params } }` for single-transform days that pass `classifyFlow`, or `{ gen, status: 'flow-implausible', entry: null }` otherwise. Multi-transform behavior (`system: 'incendia_ifs'`) is unchanged.

- [ ] **Step 1: Write the failing tests** — append to `tests/incendia.test.mjs`:

```js
describe('buildIncendiaEntry (single-transform / incendia_flow path)', () => {
  const fakeFs = {
    readdirSync(dir) {
      if (dir.endsWith('236')) return ['236_Wheel_in_the_Sky.par'];
      throw new Error(`unexpected dir ${dir}`);
    },
    readFileSync(path) {
      if (path.endsWith('236_Wheel_in_the_Sky.par')) return WHEEL_IN_THE_SKY;
      throw new Error(`unexpected file ${path}`);
    },
  };

  it('returns a live incendia_flow entry for a plausible single-transform day', () => {
    const outcome = buildIncendiaEntry(236, '236-wheel-in-the-sky', '/archive', fakeFs);
    expect(outcome.status).toBe('live');
    expect(outcome.entry.system).toBe('incendia_flow');
    expect(outcome.entry.matrices).toBe(1);
    expect(outcome.entry.params).toEqual(
      composeIncendiaBlocks(parsePar(WHEEL_IN_THE_SKY).transforms),
    );
  });

  it('does NOT apply the flat-axis correction to incendia_flow entries', () => {
    // Wheel in the Sky's translation is [-0.053282, 0, 1.848541] -- Y is exactly zero, which
    // WOULD trigger pickFlatAxisSwap for a multi-transform day. For a single-transform day this
    // must be skipped entirely (see the design spec's finding: the detection method is
    // meaningless for a single converging trajectory) -- params must be composeIncendiaBlocks
    // applied directly to the UNSWAPPED transform, not swapped.
    const outcome = buildIncendiaEntry(236, '236-wheel-in-the-sky', '/archive', fakeFs);
    const unswapped = composeIncendiaBlocks(parsePar(WHEEL_IN_THE_SKY).transforms);
    expect(outcome.entry.params.slice(9, 12)).toEqual(unswapped.slice(9, 12));
    expect(outcome.entry.params.slice(9, 12)).toEqual([-0.053282, 0, 1.848541]);
  });

  it('returns status flow-implausible with a null entry for a zero-translation transform', () => {
    const ZERO_T = crlf([
      ...HEADER('4 1', 1),
      '0.5 0 0 0', '0 0.5 0 0', '0 0 0.5 0', '1.0',
    ]);
    const fs = {
      readdirSync: () => ['999_Zero.par'],
      readFileSync: () => ZERO_T,
    };
    const outcome = buildIncendiaEntry(999, '999-zero', '/archive', fs);
    expect(outcome.status).toBe('flow-implausible');
    expect(outcome.entry).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/incendia.test.mjs`
Expected: FAIL — `buildIncendiaEntry` currently returns `status: 'single-transform'` (not `'live'`) for day 236, since the branch doesn't exist yet.

- [ ] **Step 3: Implement** — in `pipeline/incendia.mjs`, replace `buildIncendiaEntry` (currently lines 266-280):

```js
export function buildIncendiaEntry(day, slug, archiveRoot, fs) {
  const dir = join(archiveRoot, 'project', String(day).padStart(3, '0'));
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.par'));
  const chosen = pickAttractorFile(day, files, slug);
  if (!chosen) return null;
  const p = parsePar(fs.readFileSync(join(dir, chosen), 'utf8'));
  if (!p.clean) return { gen: p.gen, status: 'parse-failed', entry: null };
  if (p.transforms.length === 1) {
    const flow = classifyFlow(p.transforms[0]);
    if (!flow.plausible) return { gen: p.gen, status: 'flow-implausible', entry: null };
    // Deliberately NOT applying pickFlatAxisSwap/swapTransformAxis here -- see the design spec's
    // finding: that correction's detection method compares axis spans across one settled
    // trajectory, meaningful for a multi-transform attractor's genuine spread but not for a
    // single-transform trajectory that converges to one point on every axis simultaneously.
    const entry = { day, slug, system: 'incendia_flow', matrices: 1, params: composeIncendiaBlocks(p.transforms) };
    return { gen: p.gen, status: 'live', entry };
  }
  const cls = classify(p.transforms);
  if (!cls.plausible) return { gen: p.gen, status: 'implausible', entry: null };
  const flatAxis = pickFlatAxisSwap(p.transforms);
  const transforms = flatAxis === null ? p.transforms : swapTransformAxis(p.transforms, flatAxis);
  const entry = { day, slug, system: 'incendia_ifs', matrices: transforms.length, params: composeIncendiaBlocks(transforms) };
  return { gen: p.gen, status: 'live', entry };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/incendia.test.mjs`
Expected: **one pre-existing failure**, not a full pass yet — the `buildIncendiaEntry` describe block's test `'returns status single-transform with a null entry'` (currently around line 253, inside the `describe('buildIncendiaEntry', ...)` block using the `998_Single.par` → `SINGLE_TRANSFORM` fixture) will now fail: `SINGLE_TRANSFORM` (defined at line 88: `HEADER('4 1', 1)` + `'0.5 0 0 0', '0 0.5 0 0', '0 0 0.5 0', '1.0'`) has `t = [0, 0, 0]`, exactly the zero-translation case `classifyFlow` now catches via the NEW single-transform branch, so `buildIncendiaEntry` now returns `status: 'flow-implausible'` instead of the old blanket `'single-transform'`. Update that one test:

```js
  it('returns status flow-implausible with a null entry', () => {
    const outcome = buildIncendiaEntry(998, '998-single', '/archive', fakeFs);
    expect(outcome.status).toBe('flow-implausible');
    expect(outcome.entry).toBeNull();
  });
```

**Do NOT touch** the separate, unrelated test at line ~196, `'rejects a single-transform set (fixed point, no structure)'` — that one calls `classify(transforms)` directly (not `buildIncendiaEntry`), exercising `classify()`'s own internal `transforms.length < 2` guard, which this plan does not modify. It should already pass unchanged; if it fails, that's a real regression to investigate, not an expected update.

Re-run `npx vitest run tests/incendia.test.mjs` after the one-line fix above — expect full PASS.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

```bash
git add pipeline/incendia.mjs tests/incendia.test.mjs
git commit -m "feat(incendia-flow): wire single-transform days into buildIncendiaEntry

Single-transform .par days now go through classifyFlow instead of an
automatic reject. Pass -> system: 'incendia_flow' entry (flat-axis
correction deliberately skipped, see spec). Fail -> flow-implausible,
stays static-only same as before."
```

---

### Task 4: `INCENDIA_FLOW` family + registration

**Files:**
- Modify: `src/attractor/families/incendia.ts` (add `INCENDIA_FLOW`)
- Modify: `src/attractor/families.ts` (register)

**Interfaces:**
- Consumes: `IFS` (existing import), `AttractorFamily.randomReseed` (Task 1).
- Produces: `INCENDIA_FLOW: AttractorFamily`, registered as `FAMILIES['incendia_flow']`.

No dedicated test file for this task — per existing project convention (no `families.ts` test file exists; family shape is exercised indirectly through `computeShader` tests in Task 1, the display-estimator/pipeline tests in Tasks 2/3/5, and end-to-end in Task 7's browser spot-check).

- [ ] **Step 1: Implement** — in `src/attractor/families/incendia.ts`, add after the existing `INCENDIA_IFS` export:

```ts
// Incendia Flow (the 124 single-transform .par days -- see docs/superpowers/specs/
// 2026-07-25-incendia-flow-design.md): a single affine map has no chaos-game attractor
// structure to settle onto, just a fixed point, so this shows the honest transient dynamics
// instead -- every particle repeatedly applies the SAME one transform (IFS's existing
// stepAttractor already does this correctly for a single 13-float block: the weighted-random
// selection trivially always picks block 0), with a small per-frame chance of respawning at a
// fresh position (randomReseed) so a contractive map's particles don't all collapse to one
// static point and go still. Calibrated against the real 124-day corpus (see the spec): chance
// 0.003 (~0.3% per frame, average particle lifetime ~333 frames/~5.5s at 60fps) and
// radiusMultiplier 15 (reseed cube half-width = 15 * the transform's own translation length) are
// starting values, tunable visually -- see the spec's Task 7 calibration notes for final values.
export const INCENDIA_FLOW: AttractorFamily = {
  ...IFS,
  system: 'incendia_flow',
  randomReseed: { chance: 0.003, radiusMultiplier: 15 },
};
```

- [ ] **Step 2: Register** — in `src/attractor/families.ts`, add the import and registry entry:

```ts
import { INCENDIA_IFS, INCENDIA_FLOW } from './families/incendia';
```

(replaces the existing `import { INCENDIA_IFS } from './families/incendia';` line)

```ts
  incendia_ifs: INCENDIA_IFS,
  incendia_flow: INCENDIA_FLOW,
```

(the second line goes immediately after the existing `incendia_ifs: INCENDIA_IFS,` line inside the `FAMILIES` object)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors — `INCENDIA_FLOW`'s shape satisfies `AttractorFamily` (spread from `IFS` plus the two new fields).

- [ ] **Step 4: Full suite, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (no behavior for anything existing changed; this task only adds new exports).

```bash
git add src/attractor/families/incendia.ts src/attractor/families.ts
git commit -m "feat(incendia-flow): INCENDIA_FLOW family definition + registration

Reuses IFS's shader/disturb wholesale (a single 13-float block's
weighted selection trivially always picks itself) plus the new
randomReseed field from Task 1. Starting constants (chance 0.003,
radiusMultiplier 15) from spec calibration, tunable in Task 7."
```

---

### Task 5: Display estimation — `estimateIncendiaFlowDisplay`

**Files:**
- Modify: `src/piece.ts` (add the function after `estimateJuliaDisplay`, register in `DISPLAY_ESTIMATORS`)
- Test: `tests/piece-display.test.ts` (append)

**Interfaces:**
- Consumes: `ifsCpuStep` (already imported at `src/piece.ts:6`), `SeedSpec` (already imported at `src/piece.ts:8`).
- Produces: `estimateIncendiaFlowDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec }`, registered as `DISPLAY_ESTIMATORS['incendia_flow']`.

- [ ] **Step 1: Write the failing test** — append to `tests/piece-display.test.ts`:

```ts
describe('estimateIncendiaFlowDisplay', () => {
  it('yields a usable scale and a diverse seed pool for a real single-transform day (236)', () => {
    // day 236's real composed params (pure 0.432713x scale, translation [-0.053282, 0, 1.848541])
    const params = [
      0.432713, 0, 0, 0, 0.432713, 0, 0, 0, 0.432713, -0.053282, 0, 1.848541, 1,
    ];
    const d = estimateIncendiaFlowDisplay(params);
    expect(d.scale).toBeGreaterThan(0);
    expect(Number.isFinite(d.scale)).toBe(true);
    expect(d.seed.points.length).toBeGreaterThan(300);
    expect(d.seed.points.length % 3).toBe(0);
    for (const v of d.seed.points) expect(Number.isFinite(v)).toBe(true);
    expect(d.seed.jitter).toBeGreaterThan(0);
  });

  it('produces genuine spread across the seed pool, not a collapsed single point', () => {
    // Regression guard for the calibration-found auto-fit trap: the seed pool itself (used only
    // for SeedSpec, per the design spec) should still show real variation across its log-spaced
    // depths, not just noise-level jitter around one converged value.
    const params = [
      0.432713, 0, 0, 0, 0.432713, 0, 0, 0, 0.432713, -0.053282, 0, 1.848541, 1,
    ];
    const d = estimateIncendiaFlowDisplay(params);
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < d.seed.points.length; i += 3) {
      minX = Math.min(minX, d.seed.points[i]);
      maxX = Math.max(maxX, d.seed.points[i]);
    }
    expect(maxX - minX).toBeGreaterThan(0.01);
  });
});
```

Also add `estimateIncendiaFlowDisplay` to the existing import at the top of the file:

```ts
import { estimateChaoticFlowDisplay, estimateLorenz84Display, estimateIfsDisplay, estimateIncendiaDisplay, estimateIncendiaFlowDisplay, estimateIconDisplay, estimateUnravelDisplay, estimateJuliaDisplay } from '../src/piece';
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/piece-display.test.ts`
Expected: FAIL — `estimateIncendiaFlowDisplay is not a function`.

- [ ] **Step 3: Implement** — in `src/piece.ts`, insert after `estimateJuliaDisplay` (after its closing `}`, before the `// One entry point for...` comment):

```ts
// Incendia Flow: a single-transform trajectory just converges to a fixed point, so the existing
// "settle then sample the tail" pattern (sampleSettledTrajectory) gives no interesting bounding
// box -- there's no tail, just one point. Instead sample many independent partial trajectories
// at LOG-SPACED checkpoint depths (not a single fixed depth, and not a uniform-random range --
// both were tried and found not to work across the real corpus's contraction range 0.25-0.9468,
// see the design spec's calibration notes: a fixed/ranged depth that shows real motion for the
// slowest-converging real day is already fully converged to floating-point noise for the
// fastest, and vice versa). Log-spaced depths [1,2,4,8,16,32,64] cover from just-perturbed
// through several e-foldings of convergence regardless of the specific contraction rate, with no
// per-day tuning needed -- verified by rendering the fastest, slowest, and a mid-range real day.
//
// Scale is NOT auto-fit to the sample's own min/max (unlike every other estimator in this file)
// -- calibration found that trap directly: a fast-converging map's leftover "spread" after many
// steps is pure floating-point rounding noise (observed as small as ~1e-10), and auto-fitting
// rescales that noise to fill the frame, making a fully-converged, visually-static case look
// deceptively lively. Scale instead derives from the transform's own translation length -- a
// natural per-day scale proxy available without running any simulation at all.
const INCENDIA_FLOW_TARGET_HALF_EXTENT = 4; // matches sampleSettledTrajectory's own target
const INCENDIA_FLOW_REFERENCE_MULTIPLIER = 3; // local-space half-extent, in units of length(t)
const INCENDIA_FLOW_DEPTHS = [1, 2, 4, 8, 16, 32, 64];
export function estimateIncendiaFlowDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const tLen = Math.hypot(params[9], params[10], params[11]);
  const localHalfExtent = INCENDIA_FLOW_REFERENCE_MULTIPLIER * tLen || 0.1;
  const N = 200;
  const seedPoints: number[] = [];
  const maxDepth = INCENDIA_FLOW_DEPTHS[INCENDIA_FLOW_DEPTHS.length - 1];
  for (let k = 0; k < N; k++) {
    const s = { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 };
    let depthIndex = 0;
    for (let i = 1; i <= maxDepth; i++) {
      ifsCpuStep(params, s, Math.random);
      if (i === INCENDIA_FLOW_DEPTHS[depthIndex]) {
        depthIndex++;
        if (Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)) seedPoints.push(s.x, s.y, s.z);
      }
    }
  }
  return {
    scale: INCENDIA_FLOW_TARGET_HALF_EXTENT / localHalfExtent,
    centerX: 0, centerY: 0, centerZ: 0,
    seed: { points: Float32Array.from(seedPoints), jitter: localHalfExtent * 0.02 },
  };
}
```

Then register it in `DISPLAY_ESTIMATORS` (the `Record<string, ...>` object): add this line immediately after the existing `incendia_ifs: estimateIncendiaDisplay,` line:

```ts
  incendia_flow: estimateIncendiaFlowDisplay,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/piece-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

```bash
git add src/piece.ts tests/piece-display.test.ts
git commit -m "feat(incendia-flow): estimateIncendiaFlowDisplay

Log-spaced checkpoint-depth sampling [1,2,4,8,16,32,64] across many
independent trajectories, adapting to any contraction rate without
per-day tuning. Scale derived from length(t) directly, NOT auto-fit
to the sample's own min/max -- avoids rescaling floating-point
convergence noise into apparent motion (found during calibration)."
```

---

### Task 6: UI — family label, mode-toggle label, morph rule test

**Files:**
- Modify: `src/piece.ts:64-69` (`FAMILY_LABELS`), `src/piece.ts` (add `currentSystem()` accessor near `isHidingStatic()` at line 838)
- Modify: `src/main.ts:155-161` (`syncModeToggle`)
- Test: `tests/piece.test.ts` (append — `FAMILY_LABELS` additions), `tests/transition.test.ts` (append — morph rule)

**Interfaces:**
- Consumes: `PieceView.current` (existing private field), `PieceView.attractorsByDay` (existing private field).
- Produces: `PieceView.currentSystem(): string | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/piece.test.ts` (inside the existing `describe('familyLabel', ...)` block, as a new `it`):

```ts
  it('labels incendia_ifs and incendia_flow (phase 2c/incendia-flow)', () => {
    expect(familyLabel('incendia_ifs')).toBe('Incendia IFS');
    expect(familyLabel('incendia_flow')).toBe('Incendia flow');
  });
```

Append to `tests/transition.test.ts` (after the existing `'morphs same-family ifs days...'` test):

```ts
  it('morphs same-family incendia_flow days (same generic same-system-equal-length rule as ifs)', () => {
    const p13 = Array.from({ length: 13 }, () => 0.1);
    expect(transitionKind(
      { day: 1, system: 'incendia_flow', params: [...p13] },
      { day: 2, system: 'incendia_flow', params: [...p13] },
    )).toBe('morph');
    // different systems, even both single-block-shaped, dissolve
    expect(transitionKind(
      { day: 1, system: 'incendia_flow', params: [...p13] },
      { day: 2, system: 'incendia_ifs', params: [...p13] },
    )).toBe('dissolve');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/piece.test.ts tests/transition.test.ts`
Expected: the `familyLabel` test FAILS (`FAMILY_LABELS` doesn't have these entries yet, both calls return `null`). The `transitionKind` test should already PASS (the generic same-system-equal-length rule already exists from phase 2b/2c and needs no new code) — if it fails, stop and investigate before proceeding, don't add unneeded code.

- [ ] **Step 3: Implement**

In `src/piece.ts`, replace `FAMILY_LABELS` (lines 64-69):

```ts
const FAMILY_LABELS: Record<string, string> = {
  lorenz: 'Lorenz', lorenz_84: 'Lorenz-84', icon: 'Field–Golubitsky icon', pickover: 'Pickover',
  chaotic_flow: 'Chaotic flow', polynomial_a: 'Polynomial A', polynomial_b: 'Polynomial B',
  polynomial_c: 'Polynomial C', polynomial_func: 'Polynomial', polynomial_sprott: 'Polynomial (Sprott)',
  julia: 'Julia (quaternion)', ifs: 'IFS', unravel: 'Unravel',
  incendia_ifs: 'Incendia IFS', incendia_flow: 'Incendia flow',
};
```

In `src/piece.ts`, add a new accessor immediately after `isHidingStatic()` (after its closing `}` at line 838):

```ts
  // The open piece's current attractor system, if any -- lets main.ts's Image|Orbit mode toggle
  // show a different label ("Flow" vs "Orbit") for incendia_flow days without reaching into this
  // class's internals. Mirrors isHidingStatic()'s existing accessor pattern.
  currentSystem(): string | undefined {
    return this.current ? this.attractorsByDay.get(this.current.day)?.system : undefined;
  }
```

In `src/main.ts`, replace `syncModeToggle` (lines 155-161):

```ts
  const syncModeToggle = () => {
    const orbit = piece.isHidingStatic();
    imageBtn.classList.toggle('active', !orbit);
    orbitBtn.classList.toggle('active', orbit);
    imageBtn.setAttribute('aria-pressed', String(!orbit));
    orbitBtn.setAttribute('aria-pressed', String(orbit));
    orbitBtn.textContent = piece.currentSystem() === 'incendia_flow' ? 'Flow' : 'Orbit';
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/piece.test.ts tests/transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. (`main.ts` has no dedicated test file per existing project convention — its `syncModeToggle` change is verified in Task 7's browser spot-check.)

```bash
git add src/piece.ts src/main.ts tests/piece.test.ts tests/transition.test.ts
git commit -m "feat(incendia-flow): UI labels + Flow/Orbit toggle text

FAMILY_LABELS gains incendia_ifs (a phase-2c gap noticed along the
way) and incendia_flow. New PieceView.currentSystem() accessor lets
main.ts show 'Flow' instead of 'Orbit' on the mode toggle for
incendia_flow days, mirroring isHidingStatic()'s existing pattern."
```

---

### Task 7: Completeness test, full pipeline run, visual verification, ship

**Files:**
- Modify: `tests/attractors-completeness.test.mjs` (widen the matrices-consistency filter)
- Modify: `pipeline/build.mjs` (no change needed — already calls `applyIncendia`, which now also produces `incendia_flow` entries automatically; confirm this in Step 1)
- Regenerate: `public/data/attractors.json` (via `npm run pipeline`)

- [ ] **Step 1: Confirm no `build.mjs` change is needed**

Run: `grep -n "applyIncendia" pipeline/build.mjs`
Expected: shows the existing call `applyIncendia(chaoscopeAttractors, days, ARCHIVE, { readdirSync, readFileSync })` — this already routes through the updated `buildIncendiaEntry` from Tasks 2-3, so single-transform days will automatically produce `incendia_flow` entries the next time the pipeline runs. No code change needed here.

- [ ] **Step 2: Widen the completeness test's matrices-consistency check**

In `tests/attractors-completeness.test.mjs`, replace the last `it` block:

```js
  it('every incendia_ifs or incendia_flow entry carries a matrices count consistent with its stride-13 params', () => {
    for (const a of attractors) {
      if (a.system !== 'incendia_ifs' && a.system !== 'incendia_flow') continue;
      expect(a.params.length % 13).toBe(0);
      expect(a.matrices).toBe(a.params.length / 13);
    }
  });
```

Run: `npx vitest run tests/attractors-completeness.test.mjs`
Expected: PASS against the CURRENT (pre-regeneration) `attractors.json` — it has no `incendia_flow` entries yet, so this is a no-op check for now; it'll start exercising real data after Step 3.

- [ ] **Step 3: Run the full pipeline**

Run: `npm run pipeline`
Expected output includes a line like:

```
attractors.json: 365 entries, <N> in-scope
  incendia gen[4 1]: 98 total, 96 parsed, <M> live
  incendia gen[6 1]: 82 total, 82 parsed, <M> live
  incendia gen[7 1]: 100 total, 98 parsed, <M> live
```

where `<N>` should be **186 + up to 124 = up to 310** (186 from phase 2c, plus however many of the 124 single-transform days pass `classifyFlow` — per calibration, expect close to all 124, since the gate found no real exclusions). Run `git diff --stat public/data/attractors.json pipeline/build.mjs` afterward and confirm ONLY these two files changed (matches the phase 2c precedent — no new images/day-pages/gitignored content, this is a pure data+code change).

- [ ] **Step 4: Full regression suite against the regenerated data**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, including the widened completeness test now actually exercising real `incendia_flow` entries.

- [ ] **Step 5: Visual spot-check in the browser**

Start the dev server (`npm run dev` or the project's existing preview tooling) and check a sample of real `incendia_flow` days spanning the calibration range, switching each to "Flow" mode:

- **Fastest-converging:** day 309 (309-bow, contraction 0.25)
- **Slowest-converging:** day 131 (131-glacier, contraction 0.9468)
- **Mid-range:** day 236 (236-wheel-in-the-sky, contraction 0.43, translation Y-component exactly zero — confirms the halo provides spread without the flat-axis correction, per Task 3's design decision)

For each, confirm:
- The mode-toggle button reads **"Flow"**, not "Orbit" (Task 6).
- The particle cloud shows continuous motion — a mix of a denser converged core and a sparser halo of still-moving particles, not a single frozen dot and not an empty/blank frame.
- No console errors, no visible NaN flicker (a frame going solid black or a point flashing to a corner and back rapidly would indicate a NaN — the existing rescue should already prevent this, but confirm directly).
- Dragging to orbit-rotate still works normally.

If any day's reseed radius or scale looks visibly wrong (particles spawning too tightly clustered, or too far outside the frame to ever look connected to the core), retune `randomReseed.radiusMultiplier` in `src/attractor/families/incendia.ts` (Task 4) and/or `INCENDIA_FLOW_REFERENCE_MULTIPLIER` in `src/piece.ts` (Task 5) and re-verify — both are called out in their respective tasks as starting values, not final ones.

- [ ] **Step 6: Commit the regenerated data and finalize**

```bash
git add public/data/attractors.json tests/attractors-completeness.test.mjs
git commit -m "feat(incendia-flow): regenerate attractors.json with incendia_flow entries

Full npm run pipeline run. <N> total in-scope days (up from 186),
adding up to 124 new incendia_flow days on top of phase 2c's 186.
Widened the completeness test's matrices-consistency check to cover
both incendia_ifs and incendia_flow. Browser-verified across the
calibration range (fastest/slowest/mid-range contraction, plus a
zero-translation-axis day) -- continuous motion, correct Flow label,
no console errors."
```

- [ ] **Step 7: Update the design spec and roadmap memory with final results**

After Step 5's visual verification, update `docs/superpowers/specs/2026-07-25-incendia-flow-design.md`'s §10 (Decisions made) with the actual final tuned constants if they changed from the starting values, and the final live-day count from Step 3's pipeline output.

---

## Shipping

Once all 7 tasks are green and committed on `feat/incendia-flow`, follow the same push → PR → merge → CI-deploy flow used for phases 2b and 2c (no `scripts/deploy.sh` needed — this is a tracked data+code change only, same as phase 2c's precedent). Do not push/merge/deploy without an explicit go-ahead, matching how phases 2b and 2c were shipped.
