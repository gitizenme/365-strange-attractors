import type { AttractorFamily } from '../gpgpu';

// CORRECTED per Task 12.5 (see .superpowers/sdd/task-12.5-report.md). Task 7 originally shipped
// a guessed hypothesis for this family: a 2-variable delay-embedded quadratic recurrence
// (nx = a + b*x + c*y + d*x*x + e*x*y + f*y*y, vec3(nx, oldX, oldY)). Task 12 (working on the
// unrelated polynomial_c/func/sprott families) fetched Chaoscope's own manual page and its
// polynomial_b_equation.gif image directly and found the REAL documented formula is structurally
// different -- a 3-variable cyclically-coupled system where each equation reads all three
// previous coordinates (x, y, z), not a delay embedding of a 2-variable recurrence. This was
// independently confirmed by a second investigation before this task began. The equation
// (cyclic x->y->z->x):
//   x' = P0 + y - z*(P1 + y)
//   y' = P2 + z - x*(P3 + z)
//   z' = P4 + x - y*(P5 + x)
// (Type A -- see polynomialA.ts -- is documented as the special case P1=P3=P5=0.)
// Implemented as a discrete map (isDiscreteMap: true, x_next = ... directly, no Euler dt term):
// the equation image uses derivative notation (x-dot) like every other Chaoscope family here, but
// Chaoscope's own .csproj example files for this type have no separate dT/dt parameter (unlike
// lorenz/lorenz_84/chaotic_flow, which all do) -- the same reasoning already applied to
// polynomial_c/func/sprott in Task 12, and consistent with this family's original (now-superseded)
// Task 7 implementation, which was also a discrete map.
export const POLYNOMIAL_B: AttractorFamily = {
  system: 'polynomial_b',
  paramCount: 6,
  isDiscreteMap: true,
  // Each row has exactly two "constant-role" parameters: the row's leading additive constant
  // (P0/P2/P4) and the constant embedded inside the multiplicative term (P1/P3/P5) -- unlike
  // families with a genuine array of linear/quadratic coefficients per row, every one of this
  // family's 6 params is one of these two per-row constants, so all 6 are included.
  disturbIndices: [0, 1, 2, 3, 4, 5],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[6]) {
      float P0 = params[0];
      float P1 = params[1];
      float P2 = params[2];
      float P3 = params[3];
      float P4 = params[4];
      float P5 = params[5];
      float nx = P0 + p.y - p.z * (P1 + p.y);
      float ny = P2 + p.z - p.x * (P3 + p.z);
      float nz = P4 + p.x - p.y * (P5 + p.x);
      return vec3(nx, ny, nz);
    }
  `,
};
