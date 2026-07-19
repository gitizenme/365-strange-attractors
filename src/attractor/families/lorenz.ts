import type { AttractorFamily } from '../gpgpu';

export const LORENZ: AttractorFamily = {
  system: 'lorenz',
  paramCount: 4,
  isDiscreteMap: false,
  disturbIndices: [0, 1], // perturb sigma, rho
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[4]) {
      float sigma = params[0];
      float rho = params[1];
      float beta = params[2];
      float dt = params[3];
      float dx = sigma * (p.y - p.x);
      float dy = p.x * (rho - p.z) - p.y;
      float dz = p.x * p.y - beta * p.z;
      return p + vec3(dx, dy, dz) * dt;
    }
  `,
};
