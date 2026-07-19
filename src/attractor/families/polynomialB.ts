import type { AttractorFamily } from '../gpgpu';

export const POLYNOMIAL_B: AttractorFamily = {
  system: 'polynomial_b',
  paramCount: 6,
  isDiscreteMap: true,
  disturbIndices: [3, 4, 5],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[6]) {
      float a = params[0];
      float b = params[1];
      float c = params[2];
      float d = params[3];
      float e = params[4];
      float f = params[5];
      float nx = a + b * p.x + c * p.y + d * p.x * p.x + e * p.x * p.y + f * p.y * p.y;
      return vec3(nx, p.x, p.y);
    }
  `,
};
