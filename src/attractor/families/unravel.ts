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
