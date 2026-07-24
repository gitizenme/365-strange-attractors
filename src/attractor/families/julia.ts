import type { AttractorFamily } from '../gpgpu';

// Chaoscope Julia (manual §2.4): z, c ∈ ℍ, inverse iteration z' = (z − c)^(1/Level) with a
// uniformly random branch — converges onto the Julia set boundary of z → z^Level + c.
// Params: Level, Creal, Cimag, Phi;  c = Creal + Cimag(cos Φ·i + sin Φ·j).
// Quaternion state is (x=scalar, y=i, z=j, w=k) — stateW persists the k component through the
// position texture's alpha channel; the rendered .xyz is the scalar+i+j slice.
// (Interpretation notes and fallbacks: see the phase-2b plan, Task 6.)
//
// Verified empirically (see tests/piece-display.test.ts): the brief's primary interpretation
// (Level generalizes the map's power; Phi rotates c's imaginary part into the j axis) holds —
// day 011 "Sphere" (Level=10, tiny c) settles with >90% of sampled points within radius 1.5 of
// the origin, matching a near-unit-sphere z^10 Julia set. No empirical correction was needed.

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
