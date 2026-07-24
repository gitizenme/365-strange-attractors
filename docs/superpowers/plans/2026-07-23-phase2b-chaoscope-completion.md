# Phase 2b — Chaoscope Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the live Orbit view to the 34 remaining Chaoscope days (icon 15, julia 7, ifs 7, unravel 5), taking live coverage from 51 → 85 days, and build the generic chaos-game capability Phase 2c will reuse.

**Architecture:** Four new `AttractorFamily` plug-ins on the existing GPGPU engine (`src/attractor/gpgpu.ts`), enabled by three generic scaffold additions: a per-particle/per-frame GLSL RNG, per-instance parameter length, and optional vec4 particle state. Pipeline change is minimal: 4 new type strings in `IN_SCOPE_FAMILIES` plus slug-aware source-file picking. Everything downstream (Image|Orbit toggle, family caption, disturb, morphs, fallbacks) is data-driven and lights up automatically.

**Tech Stack:** Vite + TypeScript + Three.js (GPUComputationRenderer), vitest, Node pipeline (`pipeline/*.mjs`), sharp (already a pipeline dependency, used by the ifs layout probe).

**Spec:** `docs/superpowers/specs/2026-07-23-phase2b-chaoscope-completion-design.md`

## Global Constraints

- **NO git worktrees.** `pipeline/build.mjs` resolves `ARCHIVE = resolve('..')` — the repo must stay nested inside the art archive. Work in place on a feature branch (`feat/chaoscope-completion`).
- **The archive is read-only input.** Never modify anything outside `website/` (especially `project/`, `generated/`).
- Run tests with `npx vitest run` (whole suite) or `npx vitest run <file>` (single file). Type-check with `npx tsc --noEmit`. Both must be clean at every task boundary.
- Suite currently has 114 passing tests; never merge a task that drops below GREEN.
- WebGL2 is already a hard requirement of the live path; dynamic indexing into uniform float arrays is available.
- All four new families are **discrete maps** (`isDiscreteMap: true`) — none carries a trailing `dt` param, so `piece.ts`'s ODE pre-warm path must not fire for them.
- Formulas come from Chaoscope's own manual (equation images recovered from the mirror at `www3.fi.mdp.edu.ar/fc3/SisDin2009/Clase 2/nousado/CHAOSCOPE/help/en/manual/attractors.htm`); they are reproduced in full in the relevant tasks below. Where the manual is ambiguous (noted per-task), the task includes a bounded verification step against the 2010 render — the archive image is the ground truth.
- Commit after every task with the exact messages given; end commit messages with the standard `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

## File Structure

- `pipeline/attractors.mjs` — modify: 4 new families, `matrices` capture, slug-aware file pick.
- `src/attractor/gpgpu.ts` — modify: `AttractorFamily` interface additions, RNG + `uFrame`, per-instance param count, vec4 state, export `computeShader` for tests.
- `src/attractor/families/ifs.ts` — create: chaos-game family + `composeIfsBlocks` + `ifsLiveParams`.
- `src/attractor/families/icon.ts` — create.
- `src/attractor/families/unravel.ts` — create.
- `src/attractor/families/julia.ts` — create.
- `src/attractor/families.ts` — modify: register the four.
- `src/piece.ts` — modify: `FAMILY_LABELS`, `transitionKind` guards, `toLiveParams` helper, `DISPLAY_ESTIMATORS` entries (one per family task).
- `tests/attractors.test.mjs`, `tests/gpgpu.test.ts`, `tests/transition.test.ts`, `tests/piece-display.test.ts`, `tests/attractors-completeness.test.mjs` — extend.

---

### Task 1: Pipeline — new families, `matrices` capture, slug-aware file pick

**Files:**
- Modify: `pipeline/attractors.mjs`
- Test: `tests/attractors.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IN_SCOPE_FAMILIES` including `'icon' | 'julia' | 'ifs' | 'unravel'`; `parseCsproj(content)` return gains optional `matrices: number`; `pickAttractorFile(day, csprojFiles, slug?)` prefers a file matching the slug's title; `buildAttractors` entries for ifs days carry `matrices`.

- [ ] **Step 1: Write the failing tests** — append to `tests/attractors.test.mjs`:

```js
describe('phase 2b families', () => {
  it('parses an icon attractor block', () => {
    const src = `attractor {\n\ttype icon\n\titerations 2000000000\n\tparameters <3, 0.082, 2.688, -1.455,\n\t            0.29, -0.004>\n\texclude <0, 2, 3, 4, 5>\n}`;
    expect(parseCsproj(src)).toEqual({ type: 'icon', iterations: 2000000000, params: [3, 0.082, 2.688, -1.455, 0.29, -0.004] });
  });
  it('parses an ifs block including matrices count and weights', () => {
    const block = Array.from({ length: 32 }, (_, i) => (i % 16 === 15 ? 0.5 : 0.1)).join(', ');
    const src = `attractor {\n\ttype ifs\n\tmatrices 2\n\titerations 100000000\n\tparameters <${block}>\n\texclude <15, 31>\n}`;
    const parsed = parseCsproj(src);
    expect(parsed.type).toBe('ifs');
    expect(parsed.matrices).toBe(2);
    expect(parsed.params).toHaveLength(32);
    expect(parsed.params[15]).toBe(0.5); // weights are kept, not stripped
  });
  it('parses unravel and julia blocks', () => {
    const unravel = `attractor {\n\ttype unravel\n\titerations 20000000\n\tparameters <0.403, -0.821, 0.855, -1.908,\n\t            -1.53, 1.477, 1.869>\n}`;
    expect(parseCsproj(unravel).params).toHaveLength(7);
    const julia = `attractor {\n\ttype julia\n\titerations 20000000\n\tparameters <10, 0.051948, 0.051948, 3.14159265358979>\n}`;
    expect(parseCsproj(julia).type).toBe('julia');
  });
  it('all four new families are in scope', () => {
    for (const f of ['icon', 'julia', 'ifs', 'unravel']) expect(IN_SCOPE_FAMILIES.has(f)).toBe(true);
  });
  it('pickAttractorFile prefers the file matching the slug title', () => {
    const files = ['011_Monday.csproj', '011_Sphere.csproj'];
    expect(pickAttractorFile(11, files, '011-sphere')).toBe('011_Sphere.csproj');
    expect(pickAttractorFile(11, files, '011-monday')).toBe('011_Monday.csproj');
    // no slug match → existing behavior (first day-prefixed file)
    expect(pickAttractorFile(11, files, '011-something-else')).toBe('011_Monday.csproj');
    expect(pickAttractorFile(11, files)).toBe('011_Monday.csproj');
  });
  it('buildAttractors emits matrices for ifs days', () => {
    const block = Array.from({ length: 16 }, () => 0.1).join(', ');
    const files = { '/root/project/001': ['001_A.csproj'] };
    const contents = { '/root/project/001/001_A.csproj': `attractor {\n\ttype ifs\n\tmatrices 1\n\titerations 1\n\tparameters <${block}>\n}` };
    const fsMock = { readdirSync: d => files[d] ?? [], readFileSync: p => contents[p] };
    const [entry] = buildAttractors([{ day: 1, slug: '001-a' }], '/root', fsMock);
    expect(entry.system).toBe('ifs');
    expect(entry.matrices).toBe(1);
  });
});
```

Note: `join` in the fs mock — `buildAttractors` uses `node:path`'s `join`, so mock keys must use the platform separator; on macOS the `/`-style keys above are correct as written.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/attractors.test.mjs`
Expected: FAIL — `icon` not in scope, `matrices` undefined, slug argument ignored.

- [ ] **Step 3: Implement** — in `pipeline/attractors.mjs`:

```js
export const IN_SCOPE_FAMILIES = new Set([
  'lorenz', 'lorenz_84', 'chaotic_flow', 'pickover',
  'polynomial_a', 'polynomial_b', 'polynomial_c', 'polynomial_func', 'polynomial_sprott',
  'icon', 'julia', 'ifs', 'unravel',
]);

export function parseCsproj(content) {
  const m = content.match(/attractor\s*\{[^}]*?type\s+(\S+)[^}]*?iterations\s+(\d+)[^}]*?parameters\s*<([^>]*)>/);
  if (!m) return null;
  const params = m[3].split(',').map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
  if (params.length === 0) return null;
  const result = { type: m[1], iterations: parseInt(m[2], 10), params };
  const mat = content.match(/attractor\s*\{[^}]*?matrices\s+(\d+)/);
  if (mat) result.matrices = parseInt(mat[1], 10);
  return result;
}

export function pickAttractorFile(day, csprojFiles, slug) {
  if (csprojFiles.length === 0) return null;
  const num = String(day).padStart(3, '0');
  const prefixed = csprojFiles.filter(f => f.startsWith(`${num}_`));
  if (slug && prefixed.length > 1) {
    // '011-sphere' → 'sphere'; '011_Sphere.csproj' → 'sphere'
    const title = slug.replace(/^\d+-/, '').replace(/-/g, '');
    const bySlug = prefixed.find(f => f.slice(4).replace(/\.csproj$/, '').replace(/[_-]/g, '').toLowerCase() === title);
    if (bySlug) return bySlug;
  }
  return prefixed[0] ?? csprojFiles[0];
}
```

And in `buildAttractors`, pass the slug through and carry `matrices`:

```js
    const chosen = pickAttractorFile(day, files, slug);
    if (!chosen) return { day, slug, system: 'static-only' };
    const parsed = parseCsproj(fs.readFileSync(join(dir, chosen), 'utf8'));
    if (!parsed || !IN_SCOPE_FAMILIES.has(parsed.type)) return { day, slug, system: 'static-only' };
    const entry = { day, slug, system: parsed.type, iterations: parsed.iterations, params: parsed.params };
    if (parsed.matrices !== undefined) entry.matrices = parsed.matrices;
    return entry;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/attractors.test.mjs`
Expected: PASS, including all pre-existing tests in the file (the `pickAttractorFile` change must not break its existing tests — the old two-arg calls behave identically).

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. Note `tests/attractors-completeness.test.mjs` still expects 51 in-scope days — it reads the committed `public/data/attractors.json`, which hasn't been regenerated yet. That is correct at this boundary; the count flips to 85 in Task 8. Do NOT run the pipeline yet.

```bash
git add pipeline/attractors.mjs tests/attractors.test.mjs
git commit -m "feat: pipeline recognizes icon/julia/ifs/unravel, captures matrices, slug-aware file pick"
```

---

### Task 2: Engine scaffold — per-frame RNG, per-instance param count, vec4 state

**Files:**
- Modify: `src/attractor/gpgpu.ts`
- Test: `tests/gpgpu.test.ts`

**Interfaces:**
- Consumes: existing `AttractorFamily`, `LiveAttractor`.
- Produces (relied on by Tasks 3–6):
  - `AttractorFamily.paramCount: number | 'variable'` — `'variable'` means the instance's `params.length` is used.
  - `AttractorFamily.disturbIndices?: number[]` (now optional) and `AttractorFamily.disturbStride?: { stride: number; offsets: number[] }` — stride-repeated disturb targets for variable-count families.
  - `AttractorFamily.stateW?: boolean` — step signature becomes `vec4 stepAttractor(vec4 p, float params[N])` and `.w` persists in the position texture.
  - GLSL available to every step body: `uniform float uFrame;`, global `vec2 cgUv;` (set to the particle's uv each pass), and `float cgRand(vec2 uv, float n)`.
  - `__N__` token in `glslStep` is substituted with the instance param count.
  - `export function computeShader(family: AttractorFamily, paramCount: number): string` (exported for tests).

- [ ] **Step 1: Write the failing tests** — append to `tests/gpgpu.test.ts`:

```ts
import { computeShader, type AttractorFamily } from '../src/attractor/gpgpu';

describe('computeShader scaffold (phase 2b)', () => {
  const fixed: AttractorFamily = {
    system: 't', paramCount: 4, isDiscreteMap: true, disturbIndices: [0],
    glslStep: `vec3 stepAttractor(vec3 p, float params[4]) { return p; }`,
  };
  it('declares uFrame, cgUv and cgRand for every family', () => {
    const src = computeShader(fixed, 4);
    expect(src).toContain('uniform float uFrame;');
    expect(src).toContain('vec2 cgUv;');
    expect(src).toContain('float cgRand(');
    expect(src).toContain('cgUv = uv;');
  });
  it('sizes uniform arrays from the passed count and substitutes __N__', () => {
    const variable: AttractorFamily = {
      system: 'v', paramCount: 'variable', isDiscreteMap: true,
      disturbStride: { stride: 13, offsets: [9, 10, 11] },
      glslStep: `vec3 stepAttractor(vec3 p, float params[__N__]) { return p; }`,
    };
    const src = computeShader(variable, 26);
    expect(src).toContain('uniform float uParamsA[26];');
    expect(src).toContain('float params[26]');
    expect(src).not.toContain('__N__');
  });
  it('generates stride-repeated disturb lines', () => {
    const variable: AttractorFamily = {
      system: 'v', paramCount: 'variable', isDiscreteMap: true,
      disturbStride: { stride: 13, offsets: [9] },
      glslStep: `vec3 stepAttractor(vec3 p, float params[__N__]) { return p; }`,
    };
    const src = computeShader(variable, 26);
    expect(src).toContain('params[9] +=');
    expect(src).toContain('params[22] +=');
  });
  it('emits vec4 state handling when stateW is set', () => {
    const w: AttractorFamily = {
      system: 'w', paramCount: 4, isDiscreteMap: true, stateW: true,
      glslStep: `vec4 stepAttractor(vec4 p, float params[4]) { return p; }`,
    };
    const src = computeShader(w, 4);
    expect(src).toContain('vec4 next4 = stepAttractor');
    expect(src).toContain('gl_FragColor = vec4(next, next4.w);');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/gpgpu.test.ts`
Expected: FAIL — `computeShader` not exported, tokens missing.

- [ ] **Step 3: Implement** — in `src/attractor/gpgpu.ts`, replace the `AttractorFamily` interface and `computeShader`:

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
}

const DISTURB_LINE = (i: number) =>
  `params[${i}] += uPerturbation * (0.15 * sin(dot(uv, vec2(12.9898, 78.233)) * 43758.5453 + float(${i})));`;

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
  return /* glsl */ `
    uniform float uParamsA[${paramCount}];
    uniform float uParamsB[${paramCount}];
    uniform float uMorphMix;
    uniform float uPerturbation;
    uniform float uFrame;
    vec2 cgUv;
    float cgRand(vec2 uv, float n) {
      return fract(sin(dot(vec3(uv, n), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
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
      gl_FragColor = ${w ? 'vec4(next, next4.w)' : 'vec4(next, 1.0)'};
    }
  `;
}
```

(The rescue path becomes an early return in both modes — behavior for existing families is identical: rescued particles were previously written with alpha 1, and still are.)

In `LiveAttractor`'s constructor, derive the count, register `uFrame`, and advance it during the settling burst:

```ts
    const paramCount = family.paramCount === 'variable' ? params.length : family.paramCount;
    this.positionVariable = this.gpuCompute.addVariable('texturePosition', computeShader(family, paramCount), initial);
    this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable]);
    this.positionVariable.material.uniforms.uParamsA = { value: params.slice() };
    this.positionVariable.material.uniforms.uParamsB = { value: params.slice() };
    this.positionVariable.material.uniforms.uMorphMix = { value: 0 };
    this.positionVariable.material.uniforms.uPerturbation = { value: 0 };
    this.positionVariable.material.uniforms.uFrame = { value: 0 };
    const error = this.gpuCompute.init();
    if (error !== null) throw new Error(`GPUComputationRenderer init failed: ${error}`);

    // settling burst: iterate several times before first visible frame. uFrame MUST advance each
    // iteration — chaos-game families draw their per-step transform choice from it, and a frozen
    // uFrame would make every particle apply the same transform 150 times in a row, collapsing
    // the whole cloud onto the n transform fixed points.
    for (let i = 0; i < 150; i++) {
      this.positionVariable.material.uniforms.uFrame.value = i;
      this.gpuCompute.compute();
    }
```

And in `compute()`:

```ts
  compute(): void {
    const u = this.positionVariable.material.uniforms.uFrame;
    u.value = (u.value + 1) % 1048576;
    this.gpuCompute.compute();
    this.material.uniforms.uPosition.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/gpgpu.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green — existing family definitions satisfy the loosened interface unchanged (their `disturbIndices` remain valid; `paramCount` stays numeric).

```bash
git add src/attractor/gpgpu.ts tests/gpgpu.test.ts
git commit -m "feat: engine scaffold — per-frame RNG, per-instance param count, optional vec4 state"
```

---

### Task 3: `ifs` family — the chaos-game core

**Files:**
- Create: `src/attractor/families/ifs.ts`
- Modify: `src/attractor/families.ts`, `src/piece.ts` (DISPLAY_ESTIMATORS + import)
- Test: `tests/gpgpu.test.ts` (compose/liveParams units), `tests/piece-display.test.ts` (estimator)

**Interfaces:**
- Consumes: Task 2's scaffold (`'variable'`, `disturbStride`, `cgRand`/`uFrame`/`__N__`).
- Produces:
  - `composeIfsBlocks(fileParams: number[]): number[]` — file blocks (16 floats each) → live blocks (13 floats each: 9 row-major 3×3 matrix, 3 translation, 1 normalized weight).
  - `ifsCpuStep(live: number[], state: {x,y,z}, rand: () => number): void` — one CPU chaos-game step (shared by estimator and tests).
  - `estimateIfsDisplay(fileParams: number[])` — same shape as the other `estimate*Display` functions.
  - `IFS: AttractorFamily` registered as `ifs` in `FAMILIES`.

**File-format finding (verified against `project/011/011_Monday.csproj`):** each of the N matrices is 16 floats. Floats 0–2 of every block sit in [0, π] across all 8 day-011 blocks — rotation angles, which Chaoscope's UI edits and which are **already baked into** the 3×3 matrix that follows (the manual's equation is exactly `v' = M·v + t` with 12 numbers). Working hypothesis (layout C): `[rot 3 (UI-only, ignored)] [m0..m8 row-major 3×3] [t0..t2] [weight]`. Fallback hypothesis (layout A): `[rot 3] [scale 3] [shear 6] [translation 3] [weight]` with `M = Rz·Ry·Rx · Shear · Scale` composed at load. Step 3 below settles it empirically before any GLSL is written.

- [ ] **Step 1: Write the failing tests** — append to `tests/gpgpu.test.ts`:

```ts
import { composeIfsBlocks, ifsCpuStep } from '../src/attractor/families/ifs';

describe('ifs chaos-game core', () => {
  // identity matrix, zero translation, weight 1 → block layout C: rot(3) m(9) t(3) w(1)
  const identity16 = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  it('composeIfsBlocks maps 16-float file blocks to 13-float live blocks with normalized weights', () => {
    const live = composeIfsBlocks([...identity16, ...identity16]);
    expect(live).toHaveLength(26);
    expect(live.slice(0, 9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(live.slice(9, 12)).toEqual([0, 0, 0]);
    expect(live[12]).toBeCloseTo(0.5); // two weight-1 blocks normalize to 0.5 each
  });
  it('ifsCpuStep applies the picked affine transform', () => {
    // one transform: scale by 0.5, translate x by 1
    const live = composeIfsBlocks([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 1, 0, 0, 1]);
    const s = { x: 2, y: 4, z: 6 };
    ifsCpuStep(live, s, () => 0);
    expect(s).toEqual({ x: 2, y: 2, z: 3 });
  });
  it('day-011 params produce a bounded, non-degenerate CPU orbit', () => {
    // real day 011_Monday first two matrices (from the archive .csproj)
    const fileParams = [
      2.458, 0.247, 1.54, -0.568, 0.8, -0.498, -0.064, -0.067, 0.193, -0.123, -0.17, -0.175, 0.061, -0.233, 0.833, 0.5,
      1.871, 2.966, 2.968, -0.456, -0.209, 0.899, -0.178, 0.049, -0.039, -0.139, -0.086, 0.182, -0.655, -0.399, 0.358, 0.5,
    ];
    const live = composeIfsBlocks(fileParams);
    const s = { x: 0.1, y: 0.1, z: 0.1 };
    let rngState = 1;
    const rand = () => { rngState = (rngState * 16807) % 2147483647; return rngState / 2147483647; };
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      ifsCpuStep(live, s, rand);
      expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)).toBe(true);
      if (i > 500) seen.add(`${s.x.toFixed(2)},${s.y.toFixed(2)}`);
    }
    expect(seen.size).toBeGreaterThan(50); // not collapsed to a fixed point
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/gpgpu.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Settle the block layout empirically (probe, no commit of the probe itself)**

Write a throwaway probe to the scratchpad (NOT the repo), run it, and view the output:

```js
// scratchpad/ifs-probe.mjs — renders day 011_Monday's chaos game under both layout
// hypotheses to PNGs for visual comparison against the 2010 render.
import sharp from 'sharp'; // run with NODE_PATH=<repo>/node_modules or from the repo dir
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../project/011/011_Monday.csproj', import.meta.url), 'utf8');
const params = src.match(/parameters\s*<([^>]*)>/)[1].split(',').map(Number);
const blocks = [];
for (let i = 0; i < params.length; i += 16) blocks.push(params.slice(i, i + 16));

function layoutC(b) { return { m: b.slice(3, 12), t: b.slice(12, 15), w: b[15] }; }
function layoutA(b) {
  const [rx, ry, rz, sx, sy, sz, h0, h1, h2, h3, h4, h5, tx, ty, tz] = b;
  const cos = Math.cos, sin = Math.sin;
  const R = mul3(mul3(
    [cos(rz), -sin(rz), 0, sin(rz), cos(rz), 0, 0, 0, 1],
    [cos(ry), 0, sin(ry), 0, 1, 0, -sin(ry), 0, cos(ry)]),
    [1, 0, 0, 0, cos(rx), -sin(rx), 0, sin(rx), cos(rx)]);
  const Sh = [1, h0, h1, h2, 1, h3, h4, h5, 1];
  const S = [sx, 0, 0, 0, sy, 0, 0, 0, sz];
  return { m: mul3(mul3(R, Sh), S), t: [tx, ty, tz], w: b[15] };
}
function mul3(a, c) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++)
    o[r * 3 + k] = a[r * 3] * c[k] + a[r * 3 + 1] * c[3 + k] + a[r * 3 + 2] * c[6 + k];
  return o;
}

for (const [name, layout] of [['C', layoutC], ['A', layoutA]]) {
  const ts = blocks.map(layout);
  const wsum = ts.reduce((s, t) => s + t.w, 0);
  let x = 0.1, y = 0.1, z = 0.1;
  const W = 512, img = new Float64Array(W * W);
  const pts = [];
  for (let i = 0; i < 400000; i++) {
    let r = Math.random() * wsum, t = ts[ts.length - 1];
    for (const c of ts) { r -= c.w; if (r <= 0) { t = c; break; } }
    const nx = t.m[0] * x + t.m[1] * y + t.m[2] * z + t.t[0];
    const ny = t.m[3] * x + t.m[4] * y + t.m[5] * z + t.t[1];
    const nz = t.m[6] * x + t.m[7] * y + t.m[8] * z + t.t[2];
    x = nx; y = ny; z = nz;
    if (!Number.isFinite(x + y + z)) { x = 0.1; y = 0.1; z = 0.1; continue; }
    if (i > 100) pts.push([x, y]);
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const s = 0.95 * W / Math.max(x1 - x0, y1 - y0, 1e-9);
  for (const [px, py] of pts) {
    const ix = Math.round((px - x0) * s), iy = Math.round((py - y0) * s);
    if (ix >= 0 && ix < W && iy >= 0 && iy < W) img[iy * W + ix] += 1;
  }
  const max = Math.max(...img);
  const buf = Buffer.from(Uint8Array.from(img, v => Math.min(255, 255 * Math.sqrt(v / max))));
  await sharp(buf, { raw: { width: W, height: W, channels: 1 } }).png().toFile(`ifs-layout-${name}.png`);
  console.log(`layout ${name}: extent x[${x0.toFixed(2)},${x1.toFixed(2)}] y[${y0.toFixed(2)},${y1.toFixed(2)}]`);
}
```

Run it from the website dir (so `sharp` resolves), then Read the two PNGs and Read the 2010 master (`../generated/` file for day 011 — find it with `ls ../generated/ | grep -i 011`). Pick the layout whose point structure matches the 2010 render's overall form (branching/cluster structure, not colors). Record the verdict in `ifs.ts`'s header comment. If NEITHER resembles the render: try layout C with column-major m (`b[3],b[6],b[9],...`) as a third candidate before escalating to your human partner.

- [ ] **Step 4: Implement `src/attractor/families/ifs.ts`** (code below assumes layout C won — adjust `composeIfsBlocks` to the probe's verdict, keeping its signature and the 13-float output contract):

```ts
import type { AttractorFamily } from '../gpgpu';

// Chaoscope IFS: v' = M·v + t, one weighted-random transform per particle per step (chaos game).
// File format (verified against project/011/011_Monday.csproj, and empirically via the layout
// probe — see the plan's Task 3): each matrix is 16 floats:
//   [0..2]  rotation angles shown in Chaoscope's UI — already baked into the matrix, ignored here
//   [3..11] row-major 3×3 matrix M
//   [12..14] translation t
//   [15]    probability weight (the .csproj's `exclude` list marks exactly these indices)
// composeIfsBlocks converts N such blocks into N 13-float live blocks [M(9), t(3), w(1)] with
// weights normalized to sum 1, which is the layout the GLSL step consumes (stride 13).
export function composeIfsBlocks(fileParams: number[]): number[] {
  const out: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i + 16 <= fileParams.length; i += 16) {
    out.push(...fileParams.slice(i + 3, i + 15), 0);
    weights.push(fileParams[i + 15]);
  }
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0) || 1;
  weights.forEach((w, b) => { out[b * 13 + 12] = Math.max(0, w) / sum; });
  return out;
}

// One CPU chaos-game step over live (13-stride) blocks — mirrors the GLSL step exactly.
export function ifsCpuStep(live: number[], s: { x: number; y: number; z: number }, rand: () => number): void {
  const n = Math.floor(live.length / 13);
  let pick = rand();
  let base = (n - 1) * 13;
  for (let b = 0; b < n; b++) {
    pick -= live[b * 13 + 12];
    if (pick <= 0) { base = b * 13; break; }
  }
  const nx = live[base] * s.x + live[base + 1] * s.y + live[base + 2] * s.z + live[base + 9];
  const ny = live[base + 3] * s.x + live[base + 4] * s.y + live[base + 5] * s.z + live[base + 10];
  const nz = live[base + 6] * s.x + live[base + 7] * s.y + live[base + 8] * s.z + live[base + 11];
  s.x = nx; s.y = ny; s.z = nz;
}

export const IFS: AttractorFamily = {
  system: 'ifs',
  paramCount: 'variable', // N matrices × 13 composed floats — see composeIfsBlocks
  isDiscreteMap: true,
  disturbStride: { stride: 13, offsets: [9, 10, 11] }, // perturb each transform's translation
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[__N__]) {
      float pick = cgRand(cgUv, uFrame);
      int base = __N__ - 13;
      for (int b = 0; b * 13 < __N__; b++) {
        pick -= params[b * 13 + 12];
        if (pick <= 0.0) { base = b * 13; break; }
      }
      return vec3(
        params[base + 0] * p.x + params[base + 1] * p.y + params[base + 2] * p.z + params[base + 9],
        params[base + 3] * p.x + params[base + 4] * p.y + params[base + 5] * p.z + params[base + 10],
        params[base + 6] * p.x + params[base + 7] * p.y + params[base + 8] * p.z + params[base + 11]
      );
    }
  `,
};
```

Register in `src/attractor/families.ts` (import `IFS` from `./families/ifs`, add `ifs: IFS` to `FAMILIES`).

- [ ] **Step 5: Estimator** — in `src/piece.ts`, add next to the other `estimate*Display` functions (import `composeIfsBlocks`, `ifsCpuStep` from `./attractor/families/ifs`):

```ts
// IFS (chaos game): a single CPU chaos-game trajectory is exactly as ergodic as any other
// family's settled trajectory — same sampleSettledTrajectory pattern applies. Receives the FILE
// params (16-float blocks); LiveAttractor receives the composed 13-float blocks via toLiveParams.
export function estimateIfsDisplay(fileParams: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const live = composeIfsBlocks(fileParams);
  const s = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => ifsCpuStep(live, s, Math.random);
  return sampleSettledTrajectory(step, s, 200, 4000);
}
```

Add to `DISPLAY_ESTIMATORS`: `ifs: estimateIfsDisplay,` — and to `tests/piece-display.test.ts` append:

```ts
import { estimateIfsDisplay } from '../src/piece';

it('estimateIfsDisplay yields a usable scale and seed for a two-matrix ifs', () => {
  const fileParams = [
    2.458, 0.247, 1.54, -0.568, 0.8, -0.498, -0.064, -0.067, 0.193, -0.123, -0.17, -0.175, 0.061, -0.233, 0.833, 0.5,
    1.871, 2.966, 2.968, -0.456, -0.209, 0.899, -0.178, 0.049, -0.039, -0.139, -0.086, 0.182, -0.655, -0.399, 0.358, 0.5,
  ];
  const d = estimateIfsDisplay(fileParams);
  expect(d.scale).toBeGreaterThan(0);
  expect(Number.isFinite(d.scale)).toBe(true);
  expect(d.seed.points.length).toBeGreaterThan(300);
});
```

- [ ] **Step 6: Run all new tests**

Run: `npx vitest run tests/gpgpu.test.ts tests/piece-display.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/attractor/families/ifs.ts src/attractor/families.ts src/piece.ts tests/gpgpu.test.ts tests/piece-display.test.ts
git commit -m "feat: ifs family — chaos-game core, block composition, display estimator"
```

---

### Task 4: `icon` family

**Files:**
- Create: `src/attractor/families/icon.ts`
- Modify: `src/attractor/families.ts`, `src/piece.ts`
- Test: `tests/piece-display.test.ts`

**Interfaces:**
- Consumes: Task 2 scaffold (fixed count — no new features needed beyond it).
- Produces: `ICON: AttractorFamily` registered as `icon`; `estimateIconDisplay(params)` in `DISPLAY_ESTIMATORS`.

**Formula (Chaoscope manual, icon_equation.gif):** with `z = x + iy`, `r = z^d`:
`p = λ + α·‖v‖ + β·(x·Re r − y·Im r)`; `x' = p·x + γ·Re r − ω·y`; `y' = p·y − γ·Im r + ω·x`; `z' = ‖p‖`.
Param order in `.csproj` (per the manual's parameter list): `Degree, Alpha, Beta, Lambda, Gamma, Omega` — day 004: d=3, α=0.082, β=2.688, λ=−1.455, γ=0.29, ω=−0.004.
**Ambiguity:** the manual's `‖v‖` — implement as `|z|²` (`dot(z,z)`, the standard Field–Golubitsky form) first; if Task 8's visual verification of any icon day clearly mismatches its 2010 render, switch to `length(z)` and re-verify (one-line change in both GLSL and CPU mirror).

- [ ] **Step 1: Write the failing test** — append to `tests/piece-display.test.ts`:

```ts
import { estimateIconDisplay } from '../src/piece';

it('estimateIconDisplay: day 004 params give a bounded planar attractor with |p| height', () => {
  const d = estimateIconDisplay([3, 0.082, 2.688, -1.455, 0.29, -0.004]);
  expect(Number.isFinite(d.scale)).toBe(true);
  expect(d.scale).toBeGreaterThan(0);
  expect(d.seed.points.length).toBeGreaterThan(300);
  // z channel is |p| ≥ 0 for every seed point
  for (let i = 2; i < d.seed.points.length; i += 3) expect(d.seed.points[i]).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/piece-display.test.ts`
Expected: FAIL — `estimateIconDisplay` not exported.

- [ ] **Step 3: Implement `src/attractor/families/icon.ts`:**

```ts
import type { AttractorFamily } from '../gpgpu';

// Field–Golubitsky symmetric icon, Chaoscope's 3D embedding (manual §2.2): with z = x+iy and
// r = z^degree,  p = λ + α|z|² + β(x·Re r − y·Im r);  x' = p·x + γ·Re r − ω·y;
// y' = p·y − γ·Im r + ω·x;  and the third dimension is z' = |p|.
// Param order in the .csproj parameters block: Degree, Alpha, Beta, Lambda, Gamma, Omega.
export const ICON: AttractorFamily = {
  system: 'icon',
  paramCount: 6,
  isDiscreteMap: true,
  disturbIndices: [3, 1], // perturb Lambda, Alpha — shape-defining, small nudges stay recognizable
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[6]) {
      int d = int(params[0]);
      float alpha = params[1];
      float beta = params[2];
      float lambda = params[3];
      float gamma = params[4];
      float omega = params[5];
      vec2 z = p.xy;
      vec2 r = vec2(1.0, 0.0);
      for (int i = 0; i < 12; i++) {
        if (i >= d) break;
        r = vec2(r.x * z.x - r.y * z.y, r.x * z.y + r.y * z.x);
      }
      float pp = lambda + alpha * dot(z, z) + beta * (z.x * r.x - z.y * r.y);
      return vec3(
        pp * z.x + gamma * r.x - omega * z.y,
        pp * z.y - gamma * r.y + omega * z.x,
        abs(pp)
      );
    }
  `,
};
```

Register `icon: ICON` in `src/attractor/families.ts`.

- [ ] **Step 4: CPU estimator** — in `src/piece.ts`:

```ts
// Icon: mirrors icon.ts's glslStep (see its header for the formula). The map lives in the
// x/y plane with |p| as height, so the trajectory is genuinely 3D for display purposes.
export function estimateIconDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const d = Math.round(params[0]);
  const [, alpha, beta, lambda, gamma, omega] = params;
  const s = { x: 0.1, y: 0.1, z: 0 };
  const step = () => {
    let rx = 1, ry = 0;
    for (let i = 0; i < d; i++) { const t = rx * s.x - ry * s.y; ry = rx * s.y + ry * s.x; rx = t; }
    const pp = lambda + alpha * (s.x * s.x + s.y * s.y) + beta * (s.x * rx - s.y * ry);
    const nx = pp * s.x + gamma * rx - omega * s.y;
    const ny = pp * s.y - gamma * ry + omega * s.x;
    s.x = nx; s.y = ny; s.z = Math.abs(pp);
  };
  return sampleSettledTrajectory(step, s, 500, 4000);
}
```

Add `icon: estimateIconDisplay,` to `DISPLAY_ESTIMATORS`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/piece-display.test.ts`
Expected: PASS. If the boundedness expectation fails (trajectory escapes to Infinity), the likely cause is the `‖v‖` ambiguity — try `Math.hypot(s.x, s.y)` in place of `(s.x*s.x + s.y*s.y)` (and mirror in GLSL) before anything else.

- [ ] **Step 6: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/attractor/families/icon.ts src/attractor/families.ts src/piece.ts tests/piece-display.test.ts
git commit -m "feat: icon family — Field–Golubitsky symmetric icon with |p| height embedding"
```

---

### Task 5: `unravel` family

**Files:**
- Create: `src/attractor/families/unravel.ts`
- Modify: `src/attractor/families.ts`, `src/piece.ts`
- Test: `tests/piece-display.test.ts`

**Interfaces:**
- Consumes: Task 2 scaffold (fixed count).
- Produces: `UNRAVEL: AttractorFamily` registered as `unravel`; `estimateUnravelDisplay(params)` in `DISPLAY_ESTIMATORS`.

**Formula (Chaoscope manual, unravel_equation.gif):**
`x' = L(z + a); y' = N(x + e); z' = V(y + u)` — then, **when ‖v'‖ > r**: `p = 1 − r(⌊‖v'‖/r⌋ + 1)/‖v'‖` and `v' ← p·v'` (a radial fold back toward/through the origin — the "unravel").
Param order: `A, E, U, L, N, V, R` — day 017: a=0.403, e=−0.821, u=0.855, L=−1.908, N=−1.53, V=1.477, r=1.869.

- [ ] **Step 1: Write the failing test** — append to `tests/piece-display.test.ts`:

```ts
import { estimateUnravelDisplay } from '../src/piece';

it('estimateUnravelDisplay: day 017 params stay bounded through the fold', () => {
  const d = estimateUnravelDisplay([0.403, -0.821, 0.855, -1.908, -1.53, 1.477, 1.869]);
  expect(Number.isFinite(d.scale)).toBe(true);
  expect(d.scale).toBeGreaterThan(0);
  expect(d.seed.points.length).toBeGreaterThan(300);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/piece-display.test.ts` — Expected: FAIL (not exported).

- [ ] **Step 3: Implement `src/attractor/families/unravel.ts`:**

```ts
import type { AttractorFamily } from '../gpgpu';

// Chaoscope's own "Unravel" system (manual §2.13): a linear cyclic shift
//   x' = L(z + a);  y' = N(x + e);  z' = V(y + u)
// kept bounded by a radial fold applied whenever the new point leaves the radius-r ball:
//   p = 1 − r(⌊‖v‖/r⌋ + 1)/‖v‖ ;  v ← p·v   (p < 0 — the fold passes through the origin).
// Param order in the .csproj parameters block: A, E, U, L, N, V, R.
export const UNRAVEL: AttractorFamily = {
  system: 'unravel',
  paramCount: 7,
  isDiscreteMap: true,
  disturbIndices: [0, 1], // perturb A, E — the additive offsets, gentle and legible
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[7]) {
      float a = params[0];
      float e = params[1];
      float u = params[2];
      float L = params[3];
      float N = params[4];
      float V = params[5];
      float r = params[6];
      vec3 v = vec3(L * (p.z + a), N * (p.x + e), V * (p.y + u));
      float m = length(v);
      if (m > r && r > 0.0) {
        v *= 1.0 - (r * (floor(m / r) + 1.0)) / m;
      }
      return v;
    }
  `,
};
```

Register `unravel: UNRAVEL` in `src/attractor/families.ts`.

- [ ] **Step 4: CPU estimator** — in `src/piece.ts`:

```ts
// Unravel: mirrors unravel.ts's glslStep (see its header for the formula and the radial fold).
export function estimateUnravelDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const [a, e, u, L, N, V, r] = params;
  const s = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => {
    let nx = L * (s.z + a), ny = N * (s.x + e), nz = V * (s.y + u);
    const m = Math.hypot(nx, ny, nz);
    if (m > r && r > 0) {
      const p = 1 - (r * (Math.floor(m / r) + 1)) / m;
      nx *= p; ny *= p; nz *= p;
    }
    s.x = nx; s.y = ny; s.z = nz;
  };
  return sampleSettledTrajectory(step, s, 500, 4000);
}
```

Add `unravel: estimateUnravelDisplay,` to `DISPLAY_ESTIMATORS`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/piece-display.test.ts` — Expected: PASS.

- [ ] **Step 6: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/attractor/families/unravel.ts src/attractor/families.ts src/piece.ts tests/piece-display.test.ts
git commit -m "feat: unravel family — linear cyclic shift with radial fold"
```

---

### Task 6: `julia` family (quaternion inverse iteration)

**Files:**
- Create: `src/attractor/families/julia.ts`
- Modify: `src/attractor/families.ts`, `src/piece.ts`
- Test: `tests/piece-display.test.ts`

**Interfaces:**
- Consumes: Task 2 scaffold — this is the only family using `stateW: true`.
- Produces: `JULIA: AttractorFamily` registered as `julia`; `juliaCpuStep` (exported for tests); `estimateJuliaDisplay(params)` in `DISPLAY_ESTIMATORS`.

**Formula (Chaoscope manual, julia_equation.gif):** `z, c ∈ ℍ` (quaternions); `z' = √(z − c)` — **inverse iteration**: repeatedly applying a random branch of the inverse map converges onto the Julia set boundary. Params: `Level, Creal, Cimag, Phi`.
**Interpretation (candidate, verified visually in Task 8):** `Level` generalizes the power — the map inverted is `z → z^Level + c`, so the step takes a random `Level`-th root: for quaternion `q = m(cos θ + û sin θ)` (with `û` the unit vector part), `q^(1/n) = m^(1/n)(cos((θ+2πk)/n) + û sin((θ+2πk)/n))`, `k` uniform in `0..n−1`. Supporting evidence: day 011 "Sphere" has Level=10 with tiny `c` — a `z^10` Julia set with small `c` is a near-perfect unit sphere, matching the title. `c = Creal + Cimag·(cos Φ · i + sin Φ · j)`. Quaternion state layout: `(x=scalar, y=i, z=j, w=k)` — the rendered `.xyz` is then the standard scalar+i+j 3D slice.
**Risk containment (per spec):** if Task 8's visual verification fails for julia after trying the documented alternatives (Phi as a k-axis rotation of the whole state instead of c's phase; Level as UI detail level with the map fixed at n=2), remove `julia` from `IN_SCOPE_FAMILIES` and ship the other three families — 7 days revert to static-only, tolerated.

- [ ] **Step 1: Write the failing tests** — append to `tests/piece-display.test.ts`:

```ts
import { estimateJuliaDisplay } from '../src/piece';
import { juliaCpuStep } from '../src/attractor/families/julia';

it('juliaCpuStep inverts the forward map: (step result)^Level + c ≈ input', () => {
  const params = [2, 0.3, 0.2, 0]; // Level 2, c = 0.3 + 0.2i
  const q = { x: 0.5, y: 0.4, z: 0.1, w: 0.05 };
  const input = { ...q };
  juliaCpuStep(params, q, () => 0.9); // any branch
  // forward: q² + c (quaternion square: (s,v)² = (s²−|v|², 2sv))
  const s = q.x, vx = q.y, vy = q.z, vz = q.w;
  const fs = s * s - (vx * vx + vy * vy + vz * vz) + 0.3;
  const fx = 2 * s * vx + 0.2, fy = 2 * s * vy, fz = 2 * s * vz;
  expect(fs).toBeCloseTo(input.x, 5);
  expect(fx).toBeCloseTo(input.y, 5);
  expect(fy).toBeCloseTo(input.z, 5);
  expect(fz).toBeCloseTo(input.w, 5);
});

it('estimateJuliaDisplay: day 011 params (Level 10, small c) settle near the unit sphere', () => {
  const d = estimateJuliaDisplay([10, 0.051948, 0.051948, Math.PI]);
  expect(Number.isFinite(d.scale)).toBe(true);
  expect(d.seed.points.length).toBeGreaterThan(300);
  // magnitudes of the 3D slice cluster near ≤1 (the z^10 Julia set hugs the unit shell)
  let within = 0, total = 0;
  for (let i = 0; i + 2 < d.seed.points.length; i += 3) {
    const m = Math.hypot(d.seed.points[i], d.seed.points[i + 1], d.seed.points[i + 2]);
    total++;
    if (m < 1.5) within++;
  }
  expect(within / total).toBeGreaterThan(0.9);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/piece-display.test.ts` — Expected: FAIL (modules/exports missing).

- [ ] **Step 3: Implement `src/attractor/families/julia.ts`:**

```ts
import type { AttractorFamily } from '../gpgpu';

// Chaoscope Julia (manual §2.4): z, c ∈ ℍ, inverse iteration z' = (z − c)^(1/Level) with a
// uniformly random branch — converges onto the Julia set boundary of z → z^Level + c.
// Params: Level, Creal, Cimag, Phi;  c = Creal + Cimag(cos Φ·i + sin Φ·j).
// Quaternion state is (x=scalar, y=i, z=j, w=k) — stateW persists the k component through the
// position texture's alpha channel; the rendered .xyz is the scalar+i+j slice.
// (Interpretation notes and fallbacks: see the phase-2b plan, Task 6.)

// One CPU inverse-iteration step; mirrors the GLSL exactly. rand() supplies the branch pick.
export function juliaCpuStep(
  params: number[], q: { x: number; y: number; z: number; w: number }, rand: () => number,
): void {
  const level = Math.max(2, Math.round(params[0]));
  const phi = params[3];
  const cs = params[1], ci = params[2] * Math.cos(phi), cj = params[2] * Math.sin(phi);
  const ds = q.x - cs, dx = q.y - ci, dy = q.z - cj, dz = q.w;
  const m = Math.hypot(ds, dx, dy, dz);
  const vl = Math.hypot(dx, dy, dz);
  const theta = Math.atan2(vl, ds);
  const ux = vl > 1e-12 ? dx / vl : 1, uy = vl > 1e-12 ? dy / vl : 0, uz = vl > 1e-12 ? dz / vl : 0;
  const k = Math.floor(rand() * level);
  const nt = (theta + 2 * Math.PI * k) / level;
  const nm = Math.pow(m, 1 / level);
  q.x = nm * Math.cos(nt);
  const sv = nm * Math.sin(nt);
  q.y = sv * ux; q.z = sv * uy; q.w = sv * uz;
}

export const JULIA: AttractorFamily = {
  system: 'julia',
  paramCount: 4,
  isDiscreteMap: true,
  stateW: true,
  disturbIndices: [1, 2], // perturb Creal, Cimag — reshapes the set, Level stays integral
  glslStep: /* glsl */ `
    vec4 stepAttractor(vec4 q, float params[4]) {
      float level = max(2.0, floor(params[0] + 0.5));
      float phi = params[3];
      vec3 c = vec3(params[1], params[2] * cos(phi), params[2] * sin(phi));
      float ds = q.x - c.x;
      vec3 v = vec3(q.y - c.y, q.z - c.z, q.w);
      float m = length(vec4(ds, v));
      float vl = length(v);
      float theta = atan(vl, ds);
      vec3 u = vl > 1e-6 ? v / vl : vec3(1.0, 0.0, 0.0);
      float k = floor(cgRand(cgUv, uFrame) * level);
      float nt = (theta + 6.28318530718 * k) / level;
      float nm = pow(m, 1.0 / level);
      return vec4(nm * cos(nt), nm * sin(nt) * u);
    }
  `,
};
```

Register `julia: JULIA` in `src/attractor/families.ts`.

- [ ] **Step 4: CPU estimator** — in `src/piece.ts` (the `w` component rides in a closure; `sampleSettledTrajectory`'s state stays `{x,y,z}` = the rendered slice):

```ts
// Julia: quaternion inverse iteration (see julia.ts). The 4th quaternion component lives in a
// closure here; the estimator's xyz IS the rendered slice, so bounds/seeds line up with the GPU.
export function estimateJuliaDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const q = { x: 0.5, y: 0.3, z: 0.2, w: 0.1 };
  const s = { x: q.x, y: q.y, z: q.z };
  const step = () => {
    juliaCpuStep(params, q, Math.random);
    s.x = q.x; s.y = q.y; s.z = q.z;
  };
  return sampleSettledTrajectory(step, s, 200, 4000);
}
```

Add `julia: estimateJuliaDisplay,` to `DISPLAY_ESTIMATORS`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/piece-display.test.ts` — Expected: PASS. The inverse-check test is the load-bearing one: it proves the root-taking really inverts `q² + c`.

- [ ] **Step 6: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/attractor/families/julia.ts src/attractor/families.ts src/piece.ts tests/piece-display.test.ts
git commit -m "feat: julia family — quaternion inverse iteration with vec4 particle state"
```

---

### Task 7: Integration — labels, transition guards, live-param wiring

**Files:**
- Modify: `src/piece.ts`
- Test: `tests/transition.test.ts`, `tests/piece.test.ts`

**Interfaces:**
- Consumes: `composeIfsBlocks` (Task 3), `normalizeFuncParams` (existing).
- Produces: `toLiveParams(system: string, params: number[]): number[]`; extended `transitionKind` accepting optional `params`.

- [ ] **Step 1: Write the failing tests** — append to `tests/transition.test.ts`:

```ts
it('morphs same-family ifs days only when matrix counts match', () => {
  const p16 = Array.from({ length: 16 }, () => 0.1);
  expect(transitionKind(
    { day: 1, system: 'ifs', params: [...p16, ...p16] },
    { day: 2, system: 'ifs', params: [...p16, ...p16] },
  )).toBe('morph');
  expect(transitionKind(
    { day: 1, system: 'ifs', params: [...p16, ...p16] },
    { day: 2, system: 'ifs', params: [...p16, ...p16, ...p16] },
  )).toBe('dissolve');
});

it('morphs same-degree icon days, dissolves across degrees', () => {
  expect(transitionKind(
    { day: 1, system: 'icon', params: [3, 0.1, 0.2, 0.3, 0.4, 0.5] },
    { day: 2, system: 'icon', params: [3, 0.9, 0.8, 0.7, 0.6, 0.5] },
  )).toBe('morph');
  expect(transitionKind(
    { day: 1, system: 'icon', params: [3, 0.1, 0.2, 0.3, 0.4, 0.5] },
    { day: 2, system: 'icon', params: [5, 0.1, 0.2, 0.3, 0.4, 0.5] },
  )).toBe('dissolve');
});

it('existing behavior unchanged when params are absent', () => {
  expect(transitionKind({ day: 1, system: 'lorenz' }, { day: 2, system: 'lorenz' })).toBe('morph');
  expect(transitionKind({ day: 1, system: 'static-only' }, { day: 2, system: 'lorenz' })).toBe('dissolve');
});
```

And append to `tests/piece.test.ts`:

```ts
import { toLiveParams, familyLabel } from '../src/piece';

it('toLiveParams composes ifs blocks, normalizes polynomial_func, passes others through', () => {
  const p16 = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  expect(toLiveParams('ifs', p16)).toHaveLength(13);
  expect(toLiveParams('lorenz', [10, 28, 2.66, 0.01])).toEqual([10, 28, 2.66, 0.01]);
});

it('all four phase-2b families have caption labels', () => {
  for (const s of ['icon', 'julia', 'ifs', 'unravel']) expect(familyLabel(s)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/transition.test.ts tests/piece.test.ts`
Expected: FAIL — `params` ignored by `transitionKind`, `toLiveParams` missing, julia/ifs/unravel labels missing.

- [ ] **Step 3: Implement** — in `src/piece.ts`:

Extend `FAMILY_LABELS` (icon already exists):

```ts
  julia: 'Julia (quaternion)', ifs: 'IFS', unravel: 'Unravel',
```

Replace `transitionKind`:

```ts
export function transitionKind(
  current: { day: number; system: string; params?: number[] } | null,
  next: { day: number; system: string; params?: number[] } | null,
): 'morph' | 'dissolve' {
  if (!current || !next) return 'dissolve';
  if (current.system === 'static-only' || next.system === 'static-only') return 'dissolve';
  if (current.system !== next.system) return 'dissolve';
  // param-interpolation morphs need structurally compatible param lists: same length always
  // (ifs matrix counts differ across days), and for icon the same integer degree (the degree
  // drives a complex-power loop — a fractional mix of 3 and 5 is meaningless).
  if (current.params && next.params) {
    if (current.params.length !== next.params.length) return 'dissolve';
    if (current.system === 'icon' && current.params[0] !== next.params[0]) return 'dissolve';
  }
  return 'morph';
}
```

Add `toLiveParams` next to it and use it at BOTH live-param sites:

```ts
// One canonical file-params → LiveAttractor-params mapping. ifs composes its 16-float file
// blocks into the 13-float stride the GLSL consumes (weights normalized); polynomial_func pads
// its 3 genuinely different raw lengths into the fixed 40-slot shape; everything else passes
// through. Used by BOTH the open() construction path and the morph-target path — the two must
// never disagree on shape.
export function toLiveParams(system: string, params: number[]): number[] {
  if (system === 'ifs') return composeIfsBlocks(params);
  if (system === 'polynomial_func') return normalizeFuncParams(params);
  return params;
}
```

At the construction site (currently `const liveParams = attractor.system === 'polynomial_func' ? normalizeFuncParams(attractor.params) : attractor.params;` around `src/piece.ts:631`):

```ts
        const liveParams = toLiveParams(attractor.system, attractor.params);
```

At the morph site (in the `kind === 'morph'` branch around `src/piece.ts:536` — find the `setMorphTarget` call that passes `nextAttr.params` and wrap it):

```ts
        // morph target must go through the same file→live mapping as construction, or the
        // uniform arrays would mix incompatible layouts mid-interpolation
        this.liveAttractor.setMorphTarget(toLiveParams(nextAttr.system, nextAttr.params), /* existing mix arg unchanged */);
```

(Keep the call's existing mix-progression logic untouched — only the params argument changes.)

Also find every call site of `transitionKind` in `src/piece.ts` and ensure the attractor entries passed in include their `params` (they come from `attractorsByDay`, whose values carry `params` already — likely no change needed; verify by reading the call).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/transition.test.ts tests/piece.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/piece.ts tests/transition.test.ts tests/piece.test.ts
git commit -m "feat: family labels, structural morph guards, unified toLiveParams mapping"
```

---

### Task 8: Pipeline run, completeness at 85, full + visual verification

**Files:**
- Modify: `tests/attractors-completeness.test.mjs`, `public/data/attractors.json` (regenerated)

- [ ] **Step 1: Regenerate pipeline data**

Run from `website/`: `npm run pipeline` (the attractors step re-reads every `project/NNN/` and rewrites `public/data/attractors.json`; image steps are incremental no-ops).
Then inspect: `node -e "const a=require('./public/data/attractors.json');const c={};for(const e of a)c[e.system]=(c[e.system]??0)+1;console.log(c)"`
Expected: `static-only: 280` and in-scope families totaling **85**, with the new families near `{icon: 15, julia: 7, ifs: 7, unravel: 5}`. The slug-aware pick (Task 1) may shift a day between two same-day files (e.g. day 011 Monday↔Sphere) — a ±1 shuffle **between** the new families is acceptable if the total is 85; investigate any change to the previously-live 51 (there must be none — their days have a single in-scope csproj each) and any total ≠ 85 (compare against the spec's Section 2 table before touching parser code).

- [ ] **Step 2: Update the completeness expectation** — in `tests/attractors-completeness.test.mjs` change the count test:

```js
  it('in-scope days total 85', () => {
    expect(attractors.filter(a => a.system !== 'static-only').length).toBe(85);
  });
```

- [ ] **Step 3: Full suite + type-check + build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: all green, clean build.

- [ ] **Step 4: Visual verification per family (the Phase 2 bar)**

Start the dev server via the browser preview tooling (`.claude/launch.json` has the config; never Bash). For each family, open a sample day's piece view, toggle **Orbit**, and compare the live point cloud's character against the 2010 master render (`../generated/`, or the day page's own static image):

- `ifs`: day whose entry is system `ifs` (check attractors.json; day 011 if Monday won the pick) — branching/cluster structure should echo the render.
- `icon`: day 004 (Triangular Curves) — expect visible 3-fold dihedral symmetry in the x/y plane. If the shape is clearly wrong, apply the `‖v‖` fallback from Task 4 Step 5 and re-verify.
- `unravel`: day 017 (Marble) — bounded folded ribbon structure.
- `julia`: day 011-sphere (if Sphere won) or another julia day — expect a sphere-like shell for Level-10-small-c days. If clearly wrong, try the two documented alternatives (Task 6 header); if still wrong, remove `julia` from `IN_SCOPE_FAMILIES`, re-run the pipeline, set the completeness count to 78, and note it for review.

Also verify integration behavior on one live day: Image|Orbit toggle appears, family caption line shows, disturb (press-hold) visibly perturbs and relaxes, brightness slider works, prev/next into a static-only neighbor dissolves cleanly, console clean. And one regression day from the original 51 (e.g. day 001 chaotic_flow, day 008 lorenz) renders exactly as before.

Screenshot each family's Orbit view for the review record.

- [ ] **Step 5: Commit**

```bash
git add public/data/attractors.json tests/attractors-completeness.test.mjs
git commit -m "feat: regenerate attractors.json — 85 live days across 13 Chaoscope families"
```

---

## Self-Review Notes

- **Spec coverage:** engine chaos-game capability ✅ (Task 2), per-instance param length ✅ (Task 2), ifs with weight verification ✅ (Tasks 1, 3), icon ✅ (Task 4), unravel ✅ (Task 5), julia via inverse iteration with containment fallback ✅ (Task 6), pipeline 13 families + matrices ✅ (Task 1), morph structural guards ✅ (Task 7), labels/disturb/estimators ✅ (Tasks 3–7), completeness 85 ✅ (Task 8), per-family visual verification ✅ (Task 8), zero-regression check ✅ (Task 8).
- **Layout/formula ambiguities are contained, not deferred:** ifs block layout is settled by Task 3's probe before GLSL exists; icon's `‖v‖` and julia's Level/Phi interpretations each carry an in-task fallback with an explicit worst-case (julia → static-only, count 78).
- **Type consistency:** `composeIfsBlocks`/`ifsCpuStep`/`toLiveParams`/`estimate*Display` names and signatures are used identically across Tasks 3, 6, 7; `paramCount: number | 'variable'` and `disturbStride` match between Task 2's interface and Tasks 3–6's family definitions.
- **Known judgment call:** the morph-target site previously passed raw `nextAttr.params`; Task 7 routes it through `toLiveParams`, which also fixes a latent polynomial_func morph-shape gap. Reviewers: this is intentional.
