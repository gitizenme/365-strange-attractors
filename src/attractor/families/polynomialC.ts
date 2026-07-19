import type { AttractorFamily } from '../gpgpu';

// CALIBRATED against Chaoscope's own manual documentation (real formula, not the plan's
// guessed hypothesis). Per the plan's Task 12 brief, first checked the same manual mirror
// Task 11 used (http://www3.fi.mdp.edu.ar/.../CHAOSCOPE/help/en/manual/attractors.htm), which
// links out to a `polynomial_c_equation.gif` image and an example project file
// `projects/polynomial_c.csproj` (version 0.3.0, by "Nicolas Desprez"). Both were fetched and
// inspected directly (the equation is only published as a bitmap image, not text, so it was
// downloaded and read visually). The example .csproj has `type polynomial_c` and exactly 18
// numeric `parameters<...>` values, with no separate dT/dt field — consistent with this being
// a discrete map (like the already-shipped polynomial_a/polynomial_b, also no dt param) rather
// than an ODE integrated with a step size (unlike lorenz/lorenz_84/chaotic_flow, which all
// have an explicit trailing dT parameter). The equation image reads (P0..P17):
//   x' = P0 + x*(P1 + P2*x + P3*y) + y*(P4 + P5*y)
//   y' = P6 + y*(P7 + P8*y + P9*z) + z*(P10 + P11*z)
//   z' = P12 + z*(P13 + P14*z + P15*x) + x*(P16 + P17*x)
// i.e. a cyclic (x->y->z->x) map, each row a degree-2 polynomial in its own variable and the
// next one: [1, v, v^2, v*w, w, w^2] for (v,w) = (x,y), (y,z), (z,x) respectively. This exactly
// matches the archive's 18-value polynomial_c days (033-color-front, 051-locus) with no leftover
// or missing slots, and both of Chaoscope's Type A/Type B equation images (fetched the same way)
// documented the identical cyclic-pair structure at lower complexity (Type A: x'=p0+y-zy etc.,
// "special case of Type B where P1,P3,P5=0"; Type B: x'=p0+y-z(p1+y) etc.) confirming this is a
// real, coherent family of Chaoscope equation designs, not a one-off guess.
// NOTE (flagged, not fixed here — out of this task's scope): this discovery also shows the
// currently-shipped polynomial_a.ts/polynomial_b.ts (Task 7, "confident", not calibration-flagged)
// use a DIFFERENT formula (a 1D delay-embedded quadratic recurrence: nx = a+b*x+c*x*x,
// vec3(nx, oldX, oldY)) than what Chaoscope's own manual documents for those exact families.
// Left as-is per this task's scope (polynomial_c/func/sprott only) but worth a follow-up look.
export const POLYNOMIAL_C: AttractorFamily = {
  system: 'polynomial_c',
  paramCount: 18,
  isDiscreteMap: true,
  // p1/p7/p13 are each row's linear self-coefficient (the coefficient of the row's own
  // variable, x/y/z respectively) — plain continuous coefficients, analogous to chaotic_flow's
  // choice of "first matrix coefficient of each row" for its disturbIndices.
  disturbIndices: [1, 7, 13],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float c[18]) {
      float x = p.x; float y = p.y; float z = p.z;
      float nx = c[0] + x*(c[1] + c[2]*x + c[3]*y) + y*(c[4] + c[5]*y);
      float ny = c[6] + y*(c[7] + c[8]*y + c[9]*z) + z*(c[10] + c[11]*z);
      float nz = c[12] + z*(c[13] + c[14]*z + c[15]*x) + x*(c[16] + c[17]*x);
      return vec3(nx, ny, nz);
    }
  `,
};
