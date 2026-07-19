import type { AttractorFamily } from '../gpgpu';

// CALIBRATED against Chaoscope's own manual documentation (real formulas, not the plan's guessed
// hypothesis). The manual (http://www3.fi.mdp.edu.ar/.../CHAOSCOPE/help/en/manual/attractors.htm)
// describes "Polynomial Function" as having THREE distinct sub-types — Abs, Power, Sin — "adapted
// from Sprott's work using algebraic or trigonometric functions rather than [the] normal 2nd order
// structure", with a documented parameter-count range of "21-39". The manual links three separate
// example project files (poly_func_abs.csproj, poly_func_pow.csproj, poly_func_sin.csproj) each
// with its own equation-image; all three were fetched and read directly (equations are published
// only as bitmap images, not text). They read (Pn = params[n]):
//   Abs  (21 params, P0..P20): x' = P0 + P1*x + P2*y + P3*z + P4*|x| + P5*|y| + P6*|z|  (cyclic
//        for y'/z' with the same 7-term pattern, offset by 7 and 14)
//   Power (24 params, P0..P23): same as Abs but the LAST abs term of each row is raised to an
//        extra per-row exponent parameter: ... + P4*|x| + P5*|y| + P6*|z|^P7 (offset by 8 per row).
//        Read directly off the equation image: only the |z| term carries the exponent, |x| and
//        |y| are plain absolute values in every row — asymmetric, but that is what is drawn (no
//        enclosing parens around all three abs terms that would imply a shared exponent).
//   Sin  (39 params, P0..P38): x' = P0 + P1*x + P2*y + P3*z + P4*sin(P5*P6*x) + P7*sin(P8*P9*y) +
//        P10*sin(P11*P12*z)  (cyclic for y'/z', offset by 13 per row)
// This dataset's 6 in-scope polynomial_func days have raw parameter counts of 21 (x3: 059, 064,
// 075), 24 (x1: 044), and 39 (x2: 012, 034) — an exact match to the three documented variants'
// exact parameter counts, with no ambiguity (every real day's count lands on exactly one
// variant). The companion manual page (format.htm) confirms the raw .csproj format has a
// separate `function <abs|power|sin>` field selecting the variant, distinct from the numeric
// `parameters<...>` list — but this project's pipeline parser (pipeline/attractors.mjs) only
// captures `type`/`iterations`/`parameters`, not that field, so the variant isn't available as
// separately-parsed data here. It doesn't need to be: raw parameter count alone maps to exactly
// one variant for every real day in this archive, so `normalizeFuncParams` below infers it from
// `params.length`.
//
// Architecture note: AttractorFamily has a single fixed `paramCount` (baked into the GLSL
// uniform array size at shader-compile time), but real polynomial_func days genuinely have three
// different underlying parameter-list lengths (structurally different formulas, not a simple
// truncation of one shared shape — Sin's trig terms don't exist at all in Abs/Power). To fit the
// one-`paramCount`-per-family architecture, this family reserves ONE extra trailing slot (index
// 39) as a variant selector (0=abs, 1=pow, 2=sin) and `normalizeFuncParams` (used by piece.ts,
// mirroring how it must mirror the GLSL for CPU-side display estimation elsewhere in this
// project) pads/tags each real day's raw params into that fixed 40-slot shape before it reaches
// `LiveAttractor`.
export function normalizeFuncParams(raw: number[]): number[] {
  const out = new Array(40).fill(0);
  let variant: number;
  if (raw.length <= 21) variant = 0; // abs
  else if (raw.length <= 24) variant = 1; // power
  else variant = 2; // sin (39, or defensively anything larger)
  for (let i = 0; i < raw.length && i < 39; i++) out[i] = raw[i];
  out[39] = variant;
  return out;
}

export const POLYNOMIAL_FUNC: AttractorFamily = {
  system: 'polynomial_func',
  paramCount: 40,
  isDiscreteMap: true,
  // Indices 0-3 are the constant + linear x/y/z coefficients of the FIRST equation — the one
  // slice of the layout that means the same thing (P0 + P1*x + P2*y + P3*z, before the
  // variant-specific tail) in all three variants, so it's safe to disturb regardless of which
  // variant a given day turns out to be. Index 39 (the variant selector) is deliberately
  // excluded — it's categorical, not a continuous coefficient.
  disturbIndices: [0, 1, 2, 3],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float c[40]) {
      float x = p.x; float y = p.y; float z = p.z;
      float variant = c[39];
      if (variant < 0.5) {
        // Abs: 3 rows of 7 terms [1, x, y, z, |x|, |y|, |z|]
        float ax = abs(x); float ay = abs(y); float az = abs(z);
        float nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*ax + c[5]*ay + c[6]*az;
        float ny = c[7] + c[8]*x + c[9]*y + c[10]*z + c[11]*ax + c[12]*ay + c[13]*az;
        float nz = c[14] + c[15]*x + c[16]*y + c[17]*z + c[18]*ax + c[19]*ay + c[20]*az;
        return vec3(nx, ny, nz);
      } else if (variant < 1.5) {
        // Power: 3 rows of 8 terms [1, x, y, z, |x|, |y|, |z|^P] -- only the trailing |z| term
        // carries the row's extra exponent parameter, per the documented equation image.
        float ax = abs(x); float ay = abs(y); float az = abs(z);
        float nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*ax + c[5]*ay + c[6]*pow(az, c[7]);
        float ny = c[8] + c[9]*x + c[10]*y + c[11]*z + c[12]*ax + c[13]*ay + c[14]*pow(az, c[15]);
        float nz = c[16] + c[17]*x + c[18]*y + c[19]*z + c[20]*ax + c[21]*ay + c[22]*pow(az, c[23]);
        return vec3(nx, ny, nz);
      } else {
        // Sin: 3 rows of 13 terms [1, x, y, z, A*sin(f1*f2*x), A*sin(f1*f2*y), A*sin(f1*f2*z)]
        float nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*sin(c[5]*c[6]*x) + c[7]*sin(c[8]*c[9]*y) + c[10]*sin(c[11]*c[12]*z);
        float ny = c[13] + c[14]*x + c[15]*y + c[16]*z + c[17]*sin(c[18]*c[19]*x) + c[20]*sin(c[21]*c[22]*y) + c[23]*sin(c[24]*c[25]*z);
        float nz = c[26] + c[27]*x + c[28]*y + c[29]*z + c[30]*sin(c[31]*c[32]*x) + c[33]*sin(c[34]*c[35]*y) + c[36]*sin(c[37]*c[38]*z);
        return vec3(nx, ny, nz);
      }
    }
  `,
};
