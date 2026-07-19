import type { AttractorFamily } from '../gpgpu';

// CORRECTED per Task 12.5 (see .superpowers/sdd/task-12.5-report.md). Task 7 originally shipped
// a guessed hypothesis for this family: a 1D delay-embedded quadratic recurrence
// (nx = a + b*x + c*x*x, vec3(nx, oldX, oldY)). Task 12 (working on the unrelated
// polynomial_c/func/sprott families) fetched Chaoscope's own manual page and its
// polynomial_a_equation.gif image directly and found the REAL documented formula is structurally
// different -- a 3-variable cyclically-coupled system where each equation reads all three
// previous coordinates (x, y, z), not a delay embedding of a single 1D recurrence. This was
// independently confirmed by a second investigation before this task began. The equation:
//   x' = P0 + y - z*y
//   y' = P1 + z - x*z
//   z' = P2 + x - y*x
// The manual captions Type A as "a special case of Type B" (see polynomialB.ts) with Type B's
// P1/P3/P5 forced to 0 -- consistent with this shape (Type B's x' = P0 + y - z*(P1+y) reduces to
// exactly this family's x' = P0 + y - z*y when P1=0).
// Implemented as a discrete map (isDiscreteMap: true, x_next = ... directly, no Euler dt term):
// the equation image uses derivative notation (x-dot) like every other Chaoscope family here, but
// Chaoscope's own .csproj example files for this type have no separate dT/dt parameter (unlike
// lorenz/lorenz_84/chaotic_flow, which all do) -- the same reasoning already applied to
// polynomial_c/func/sprott in Task 12, and consistent with this family's original (now-superseded)
// Task 7 implementation, which was also a discrete map.
export const POLYNOMIAL_A: AttractorFamily = {
  system: 'polynomial_a',
  paramCount: 3,
  isDiscreteMap: true,
  // P0/P1/P2 are each row's sole additive/self constant -- the one coefficient every row has,
  // analogous to chaotic_flow's/polynomial_c's/polynomial_sprott's "one representative
  // coefficient per row" convention.
  disturbIndices: [0, 1, 2],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[3]) {
      float P0 = params[0];
      float P1 = params[1];
      float P2 = params[2];
      float nx = P0 + p.y - p.z * p.y;
      float ny = P1 + p.z - p.x * p.z;
      float nz = P2 + p.x - p.y * p.x;
      return vec3(nx, ny, nz);
    }
  `,
};
