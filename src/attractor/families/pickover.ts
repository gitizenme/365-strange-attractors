import type { AttractorFamily } from '../gpgpu';

export const PICKOVER: AttractorFamily = {
  system: 'pickover',
  paramCount: 4,
  isDiscreteMap: true,
  disturbIndices: [0, 2], // perturb A, C
  glslStep: /* glsl */ `
    vec3 stepAttractor(vec3 p, float params[4]) {
      float A = params[0];
      float B = params[1];
      float C = params[2];
      float D = params[3];
      float nx = sin(A * p.y) - p.z * cos(B * p.x);
      float ny = p.z * sin(C * p.x) - cos(D * p.y);
      float nz = sin(p.x);
      return vec3(nx, ny, nz);
    }
  `,
};
