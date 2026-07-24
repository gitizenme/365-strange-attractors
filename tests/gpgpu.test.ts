import { describe, it, expect } from 'vitest';
import { fillSeedTexture } from '../src/attractor/gpgpu';

// Small texture-shaped buffer standing in for a GPUComputationRenderer DataTexture's backing
// array (RGBA texels, 4 floats each — only the first 3 are position, the 4th is unused alpha).
function makeBuffer(texelCount: number): Float32Array {
  return new Float32Array(texelCount * 4);
}

describe('fillSeedTexture', () => {
  it('defaults to near-identical random points in [-0.05, 0.05] per axis when no seed is given', () => {
    const data = makeBuffer(64);
    fillSeedTexture(data);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(-0.05);
      expect(data[i]).toBeLessThanOrEqual(0.05);
      expect(data[i + 1]).toBeGreaterThanOrEqual(-0.05);
      expect(data[i + 1]).toBeLessThanOrEqual(0.05);
      expect(data[i + 2]).toBeGreaterThanOrEqual(-0.05);
      expect(data[i + 2]).toBeLessThanOrEqual(0.05);
      expect(data[i + 3]).toBe(1);
    }
  });

  it('falls back to the default random fill when seed.points has fewer than one full point', () => {
    const data = makeBuffer(16);
    fillSeedTexture(data, { points: new Float32Array([1, 2]), jitter: 0.1 });
    for (let i = 0; i < data.length; i += 4) {
      expect(Math.abs(data[i])).toBeLessThanOrEqual(0.05);
    }
  });

  it('seeds every texel from a real point in the pool, within jitter, when a seed is given', () => {
    // A pool of points far from the origin's default cluster — if seeding worked, every texel
    // should land near one of these, not in the [-0.05, 0.05] default cube.
    const pool = new Float32Array([
      10, 20, -30,
      -5, 15, 25,
      100, -100, 50,
    ]);
    const jitter = 0.2;
    const data = makeBuffer(500);
    fillSeedTexture(data, { points: pool, jitter });

    for (let i = 0; i < data.length; i += 4) {
      const x = data[i], y = data[i + 1], z = data[i + 2];
      // Must be within jitter of *some* pool point (Euclidean per-axis bound).
      let matched = false;
      for (let p = 0; p < pool.length; p += 3) {
        const dx = Math.abs(x - pool[p]);
        const dy = Math.abs(y - pool[p + 1]);
        const dz = Math.abs(z - pool[p + 2]);
        if (dx <= jitter / 2 + 1e-9 && dy <= jitter / 2 + 1e-9 && dz <= jitter / 2 + 1e-9) {
          matched = true;
          break;
        }
      }
      expect(matched).toBe(true);
      expect(data[i + 3]).toBe(1);
    }
  });

  it('draws from every point in the pool over enough texels (not just the first)', () => {
    const pool = new Float32Array([0, 0, 0, 1000, 1000, 1000]);
    const data = makeBuffer(200);
    fillSeedTexture(data, { points: pool, jitter: 0.01 });
    const nearOrigin = [...data].filter((_, idx) => idx % 4 === 0).filter(x => Math.abs(x) < 1).length;
    const nearFar = [...data].filter((_, idx) => idx % 4 === 0).filter(x => Math.abs(x - 1000) < 1).length;
    expect(nearOrigin).toBeGreaterThan(0);
    expect(nearFar).toBeGreaterThan(0);
    expect(nearOrigin + nearFar).toBe(200);
  });
});

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
  it('wraps the frame count inside cgRand so large uFrame values cannot swamp the uv term', () => {
    const src = computeShader(fixed, 4);
    expect(src).toContain('mod(n, 1024.0)');
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

import { composeIfsBlocks, ifsCpuStep } from '../src/attractor/families/ifs';

describe('ifs chaos-game core', () => {
  // Layout A (see ifs.ts's header comment for the probe verdict): [rot(3) scale(3) shear(6)
  // translation(3) weight(1)], composed at load time into M = Rz·Ry·Rx·Shear·Scale. Zero rotation,
  // unit scale, zero shear, zero translation, weight 1 → identity M, zero t.
  const identity16 = [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  it('composeIfsBlocks maps 16-float file blocks to 13-float live blocks with normalized weights', () => {
    const live = composeIfsBlocks([...identity16, ...identity16]);
    expect(live).toHaveLength(26);
    expect(live.slice(0, 9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(live.slice(9, 12)).toEqual([0, 0, 0]);
    expect(live[12]).toBeCloseTo(0.5); // two weight-1 blocks normalize to 0.5 each
  });
  it('ifsCpuStep applies the picked affine transform', () => {
    // one transform: zero rotation/shear, uniform scale by 0.5, translate x by 1
    const live = composeIfsBlocks([0, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
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
