import type { AttractorFamily } from '../gpgpu';

// Chaoscope IFS: v' = M·v + t, one weighted-random transform per particle per step (chaos game).
//
// File format: each matrix is 16 floats. The manual's core equation (v' = M·v + t, a 3×3 matrix
// M row-major plus a 3-float translation t) describes the LIVE per-transform representation, not
// the raw on-disk layout — Chaoscope's UI edits rotation/scale/shear/translation independently and
// composes them into M at load time, matching this task's layout-A hypothesis:
//   [0..2]   rotation angles (rx, ry, rz)
//   [3..5]   scale (sx, sy, sz)
//   [6..11]  shear (h0..h5)
//   [12..14] translation t
//   [15]     probability weight
// M = Rz·Ry·Rx · Shear · Scale, composed here at load time (row-major 3×3).
//
// PROBE VERDICT (empirical, see the plan's Task 3 and task-3-report.md): rendered both layout-C
// and layout-A hypotheses (plus a layout-C column-major variant) as CPU chaos-game point clouds
// for two real archive days and compared against their 2010 master renders. Day 011's own IFS
// variant (011_Monday.csproj) was never the day's chosen/rendered artwork — 011_Binary_Stars
// (type julia) was — so there is no 2010 master to compare an IFS probe against for day 011;
// 021_Fern (project/021/021_Fern.csproj, type ifs, matrices 4) was used instead, since its
// basename also appears in generated/021_Fern.jpg (i.e. it WAS the chosen/rendered piece), giving
// a real ground truth. Layout A reproduced a clean, richly self-similar, recognizably fern/tree-
// shaped fractal — matching both the "Fern" title and the master render's repeated-frond branching
// structure. Layout C and layout-C-column-major both collapsed to a sparse tangle of nearly
// straight crossing lines for that day — clearly wrong, not a rich 2D fractal at all. Cross-checked
// against day 011 (011_Monday, 8 matrices, no master available but still informative): layout A
// gave a dense, well-filled, structured point cloud typical of a good chaos-game attractor, while
// layout C again collapsed to a thin degenerate scribble. Verdict: layout A.
//
// composeIfsBlocks converts N such 16-float blocks into N 13-float live blocks [M(9), t(3), w(1)]
// with weights normalized to sum 1, which is the layout the GLSL step consumes (stride 13).
function mul3(a: number[], c: number[]): number[] {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) {
      o[r * 3 + k] = a[r * 3] * c[k] + a[r * 3 + 1] * c[3 + k] + a[r * 3 + 2] * c[6 + k];
    }
  }
  return o;
}

export function composeIfsBlocks(fileParams: number[]): number[] {
  const out: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i + 16 <= fileParams.length; i += 16) {
    const [rx, ry, rz, sx, sy, sz, h0, h1, h2, h3, h4, h5, tx, ty, tz, w] = fileParams.slice(i, i + 16);
    const cos = Math.cos, sin = Math.sin;
    const Rz = [cos(rz), -sin(rz), 0, sin(rz), cos(rz), 0, 0, 0, 1];
    const Ry = [cos(ry), 0, sin(ry), 0, 1, 0, -sin(ry), 0, cos(ry)];
    const Rx = [1, 0, 0, 0, cos(rx), -sin(rx), 0, sin(rx), cos(rx)];
    const R = mul3(mul3(Rz, Ry), Rx);
    const Sh = [1, h0, h1, h2, 1, h3, h4, h5, 1];
    const S = [sx, 0, 0, 0, sy, 0, 0, 0, sz];
    const M = mul3(mul3(R, Sh), S);
    out.push(...M, tx, ty, tz, 0);
    weights.push(w);
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
