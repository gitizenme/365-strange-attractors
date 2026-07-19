import type { AttractorFamily } from '../gpgpu';

export const LORENZ_84: AttractorFamily = {
  system: 'lorenz_84',
  paramCount: 5,
  isDiscreteMap: false,
  disturbIndices: [0, 2], // perturb a, F
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[5]) {
      float a = params[0];
      float b = params[1];
      float F = params[2];
      float G = params[3];
      float dt = params[4];
      float dx = -p.y * p.y - p.z * p.z - a * p.x + a * F;
      float dy = p.x * p.y - b * p.x * p.z - p.y + G;
      float dz = b * p.x * p.y + p.x * p.z - p.z;
      return p + vec3(dx, dy, dz) * dt;
    }
  `,
};
