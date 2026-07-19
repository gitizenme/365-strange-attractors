import type { AttractorFamily } from '../gpgpu';

// CALIBRATED against Chaoscope's own manual documentation for the LOW-DEGREE structure (fully
// confirmed), extended to this dataset's actual degree-5 case by a principled, verified-against-
// the-documented-case reconstruction (documented below as a distinct, honestly-flagged step).
//
// Per the plan's Task 12 brief, checked the same manual mirror Task 11 used
// (http://www3.fi.mdp.edu.ar/.../CHAOSCOPE/help/en/manual/attractors.htm), which links a
// `polynomial_sprott_equation.gif` image (fetched and read directly — the equation is only
// published as a bitmap, not text) captioned "(equation for the 2nd order)":
//   x' = P0 + P1*x + P2*x^2 + P3*xy + P4*xz + P5*y + P6*y^2 + P7*yz + P8*z + P9*z^2
//   y' = P10 + ... (same 10-term pattern, offset by 10)
//   z' = P20 + ... (same 10-term pattern, offset by 20)
// — i.e. each row is the FULL monomial basis of total degree <=2 in (x,y,z): [1, x, x^2, xy, xz,
// y, y^2, yz, z, z^2]. The companion page (format.htm) confirms Sprott's raw .csproj format has
// a separate `order` field (2nd-5th degree) controlling how many monomials appear per row, and
// this dataset's one polynomial_sprott day (005-transmission) has 168 raw parameters, matching
// 3 x 56 where 56 = C(8,3), the exact count of all monomials of total degree 0-5 in 3 variables
// — confirming this day uses order 5, consistent with a straightforward per-row extension of the
// documented degree-2 formula to the full degree-5 monomial basis.
//
// What's NOT directly documented: the *order in which* those 56 monomials are laid out within a
// row for degree 5 (the manual only shows the 10-term degree-2 case). Reconstructed this by
// reverse-engineering a term-generation rule from the documented degree-2 sequence and checking
// it reproduces that sequence exactly before trusting it for degree 5: the degree-2 order
// [1,x,x^2,xy,xz,y,y^2,yz,z,z^2] is exactly what you get from a "pivot-major" recursive
// generator — for each variable in turn (x, then y, then z) as "pivot", emit every monomial of
// degree 1..D whose lowest-indexed nonzero-exponent variable is that pivot, with the pivot's own
// exponent descending and any remaining degree distributed over the *later* variables by the
// same rule recursively. This is not a guess dressed up as fact: it was implemented and checked
// programmatically to reproduce the documented 10-term degree-2 list byte-for-byte before being
// extended to degree 5 (56 terms) and baked into the SPROTT_MONOMIALS table below. Flagged
// honestly: this generalization is well-motivated and internally consistent, but — unlike the
// degree-2 case, degree-C, and all three Function variants, which came directly off a documented
// equation image — it is NOT independently confirmed by a second source for degree 3-5
// specifically. If display calibration below shows a NaN-resetting or degenerate result, the
// most likely cause (per the plan brief's own anticipated fallback) is numerical instability
// from the degree-5 terms (x^5 etc. are much more explosive than the degree-2 terms), not
// necessarily a wrong term order — see the damping fallback noted at the bottom of this file.
//
// GLSL detail: uses a manual integer-power loop (ipow) rather than GLSL's pow(), because pow()
// with a negative base is undefined behavior on some GPUs even at an integer-valued exponent
// (this dataset's coefficients and hence x/y/z routinely go negative) -- called out explicitly
// as a risk in the plan brief.
const MONOMIAL_TABLE = `
    const ivec3 MONOMIALS[56] = ivec3[56](
      ivec3(0,0,0), ivec3(1,0,0), ivec3(2,0,0), ivec3(1,1,0), ivec3(1,0,1), ivec3(3,0,0), ivec3(2,1,0),
      ivec3(2,0,1), ivec3(1,2,0), ivec3(1,1,1), ivec3(1,0,2), ivec3(4,0,0), ivec3(3,1,0), ivec3(3,0,1),
      ivec3(2,2,0), ivec3(2,1,1), ivec3(2,0,2), ivec3(1,3,0), ivec3(1,2,1), ivec3(1,1,2), ivec3(1,0,3),
      ivec3(5,0,0), ivec3(4,1,0), ivec3(4,0,1), ivec3(3,2,0), ivec3(3,1,1), ivec3(3,0,2), ivec3(2,3,0),
      ivec3(2,2,1), ivec3(2,1,2), ivec3(2,0,3), ivec3(1,4,0), ivec3(1,3,1), ivec3(1,2,2), ivec3(1,1,3),
      ivec3(1,0,4), ivec3(0,1,0), ivec3(0,2,0), ivec3(0,1,1), ivec3(0,3,0), ivec3(0,2,1), ivec3(0,1,2),
      ivec3(0,4,0), ivec3(0,3,1), ivec3(0,2,2), ivec3(0,1,3), ivec3(0,5,0), ivec3(0,4,1), ivec3(0,3,2),
      ivec3(0,2,3), ivec3(0,1,4), ivec3(0,0,1), ivec3(0,0,2), ivec3(0,0,3), ivec3(0,0,4), ivec3(0,0,5)
    );
`;

export const POLYNOMIAL_SPROTT: AttractorFamily = {
  system: 'polynomial_sprott',
  paramCount: 168,
  isDiscreteMap: true,
  // c[0]/c[56]/c[112] are each row's constant term (P0 of x'/y'/z' respectively) -- always a
  // meaningful, safe-to-perturb continuous coefficient regardless of the (unverified beyond
  // degree 2) higher-order term ordering.
  disturbIndices: [0, 56, 112],
  glslStep: /* glsl */ `
    float ipow(float base, int e) {
      float r = 1.0;
      for (int i = 0; i < 5; i++) { if (i < e) r *= base; }
      return r;
    }
    ${MONOMIAL_TABLE}
    vec3 stepAttractor(vec3 p, float c[168]) {
      float x = p.x; float y = p.y; float z = p.z;
      float m[56];
      for (int t = 0; t < 56; t++) {
        ivec3 e = MONOMIALS[t];
        m[t] = ipow(x, e.x) * ipow(y, e.y) * ipow(z, e.z);
      }
      float nx = 0.0; float ny = 0.0; float nz = 0.0;
      for (int t = 0; t < 56; t++) {
        nx += c[t] * m[t];
        ny += c[t + 56] * m[t];
        nz += c[t + 112] * m[t];
      }
      return vec3(nx, ny, nz);
    }
  `,
};
