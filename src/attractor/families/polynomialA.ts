import type { AttractorFamily } from '../gpgpu';

export const POLYNOMIAL_A: AttractorFamily = {
  system: 'polynomial_a',
  paramCount: 3,
  isDiscreteMap: true,
  disturbIndices: [1, 2],
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[3]) {
      float a = params[0];
      float b = params[1];
      float c = params[2];
      float nx = a + b * p.x + c * p.x * p.x;
      return vec3(nx, p.x, p.y);
    }
  `,
};
