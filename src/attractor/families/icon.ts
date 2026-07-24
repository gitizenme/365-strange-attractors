import type { AttractorFamily } from '../gpgpu';

// Field–Golubitsky symmetric icon, Chaoscope's 3D embedding (manual §2.2): with z = x+iy and
// r = z^degree,  p = λ + α|z|² + β(x·Re r − y·Im r);  x' = p·x + γ·Re r − ω·y;
// y' = p·y − γ·Im r + ω·x;  and the third dimension is z' = |p|.
// Param order in the .csproj parameters block: Degree, Alpha, Beta, Lambda, Gamma, Omega.
export const ICON: AttractorFamily = {
  system: 'icon',
  paramCount: 6,
  isDiscreteMap: true,
  disturbIndices: [3, 1], // perturb Lambda, Alpha — shape-defining, small nudges stay recognizable
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[6]) {
      int d = int(params[0]);
      float alpha = params[1];
      float beta = params[2];
      float lambda = params[3];
      float gamma = params[4];
      float omega = params[5];
      vec2 z = p.xy;
      vec2 r = vec2(1.0, 0.0);
      for (int i = 0; i < 12; i++) {
        if (i >= d) break;
        r = vec2(r.x * z.x - r.y * z.y, r.x * z.y + r.y * z.x);
      }
      float pp = lambda + alpha * dot(z, z) + beta * (z.x * r.x - z.y * r.y);
      return vec3(
        pp * z.x + gamma * r.x - omega * z.y,
        pp * z.y - gamma * r.y + omega * z.x,
        abs(pp)
      );
    }
  `,
};
