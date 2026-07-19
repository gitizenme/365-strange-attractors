import type { AttractorFamily } from '../gpgpu';

// CALIBRATED (see plan Task 11 report, .superpowers/sdd/task-11-report.md, for the full
// investigation). The brief's starting hypothesis (treating all 22 stored numbers as a flat
// 22-of-30 subset of Sprott's dense monomial-basis coefficients) and its 4 documented
// alternates (alt cross-term mapping, raw-order truncation, alt dt, discrete map) were all
// tried and ALL diverge to infinity within a few hundred steps for the reference days —
// confirmed both by CPU simulation and in-browser. The real cause: 9 of the file's 22 numbers
// are not coefficients at all. Cross-checking the archive's raw values (parsed straight from
// the .csproj `parameters<...>` list, see pipeline/attractors.mjs's parseCsproj) across all 17
// chaotic_flow days shows 9 fixed positions per file are always exact small integers in
// {0,1,2,3}, identically positioned every time — never true coefficients. Chaoscope's own
// manual (chaoscope.org/doc/attractors.html, mirrored at
// flagadou.free.fr/manual/attractors.htm#chaotic_flow, equation image
// flagadou.free.fr/images/chaotic_flow_equation.gif) documents exactly why: Chaotic Flow is
// the one Chaoscope formula where "the position of the variables (x, y, z) is itself a
// parameter, Mi Op" — i.e. each of 9 matrix coefficients m_i is multiplied not just by its
// row/column variable but by a SECOND, independently-chosen variable Op_i in {1, x, y, z}
// (encoded here as {0,1,2,3}), turning what looks like a linear term into a linear-or-quadratic
// term depending on Op_i. The documented equation:
//   Op_i in {1, x, y, z}
//   v' = v + d * (M * v + [m3, m7, m11])   where M = [[m0*Op0, m1*Op1, m2*Op2],
//                                                      [m4*Op4, m5*Op5, m6*Op6],
//                                                      [m8*Op8, m9*Op9, m10*Op10]], v=(x,y,z)
// This reading was cross-validated by decoding the manual's Lorenz and Lorenz-84 equation
// images the same way and confirming they reproduce lorenz.ts/lorenz84.ts's already-verified
// formulas exactly. The file's interleaved (coefficient, Op-selector, ...) layout per equation
// — [m,Op,m,Op,m,Op,const] x3, then a trailing dT — matches the archive's int/float position
// pattern exactly (12 float coefficients + 9 integer selectors + 1 float dT = 22). This
// formula was simulated on the CPU for all 3 reference days plus 5 additional spot-check days
// and stays bounded/structured (never explodes or collapses) for all 8.
//
// FOLLOW-UP FINDING (see task-11-report.md's "Independent re-verification" section for full
// detail): the "confirmed visually in-browser" claim above holds cleanly for 001-rose and
// 020-outlier — both reproduce the reference image's structure almost immediately at the app's
// normal live-preview budget. It does NOT hold in practice for 025-sometimes-chaos (and several
// other days with small dT). The formula itself is fine there too — long CPU runs and, separately,
// hundreds of thousands of forced GPU compute() steps both confirm the values stay bounded and
// settle into a extent consistent across CPU and GPU — but LiveAttractor (gpgpu.ts, pre-existing)
// seeds ~1M points from nearly-identical random starts near the origin, so the cloud only visually
// "fills in" at the rate nearby trajectories decorrelate (the system's mixing/Lyapunov timescale).
// For 025 and similarly slow-mixing days that timescale is far beyond any practical prewarm
// budget — the live cloud is a near-invisible collapsed sliver for a long time, not the reference's
// dense fan structure. This is a display/architecture limitation exposed by this family's
// parameters, not a wrong formula or wrong byte-order — but it means the acceptance bar ("bounded,
// non-degenerate, visibly-structured... for all three days") is not actually met for 025 under
// real viewing conditions. Flagged for follow-up rather than silently shipped as fully verified.
export const CHAOTIC_FLOW: AttractorFamily = {
  system: 'chaotic_flow',
  paramCount: 22,
  isDiscreteMap: false,
  // c[0]/c[7]/c[14] are m0/m4/m8, the first matrix coefficient of each row (x'/y'/z') — plain
  // float coefficients, safe to perturb continuously. The 9 Op-selector slots (c[1,3,5,8,10,12,
  // 15,17,19]) are deliberately excluded: they're categorical indices into {1,x,y,z}, not
  // continuous coefficients, so nudging them would just relabel which variable a term uses
  // rather than meaningfully "disturb" the flow.
  disturbIndices: [0, 7, 14],
  glslStep: /* glsl */ `
    // Op selector: 0 -> 1 (constant), 1 -> x, 2 -> y, 3 -> z.
    float chaoticFlowOp(float idx, vec3 p) {
      if (idx < 0.5) return 1.0;
      if (idx < 1.5) return p.x;
      if (idx < 2.5) return p.y;
      return p.z;
    }
    vec3 stepAttractor(vec3 p, float c[22]) {
      float dT = c[21];
      float x = p.x; float y = p.y; float z = p.z;
      // Row 0 (x'): m0*Op0*x + m1*Op1*y + m2*Op2*z + m3   -> c[0..6]
      float dx = c[0]*chaoticFlowOp(c[1], p)*x + c[2]*chaoticFlowOp(c[3], p)*y + c[4]*chaoticFlowOp(c[5], p)*z + c[6];
      // Row 1 (y'): m4*Op4*x + m5*Op5*y + m6*Op6*z + m7   -> c[7..13]
      float dy = c[7]*chaoticFlowOp(c[8], p)*x + c[9]*chaoticFlowOp(c[10], p)*y + c[11]*chaoticFlowOp(c[12], p)*z + c[13];
      // Row 2 (z'): m8*Op8*x + m9*Op9*y + m10*Op10*z + m11 -> c[14..20]
      float dz = c[14]*chaoticFlowOp(c[15], p)*x + c[16]*chaoticFlowOp(c[17], p)*y + c[18]*chaoticFlowOp(c[19], p)*z + c[20];
      return p + vec3(dx, dy, dz) * dT;
    }
  `,
};
