import type { AttractorFamily } from './gpgpu';
import { LORENZ } from './families/lorenz';
import { LORENZ_84 } from './families/lorenz84';
import { PICKOVER } from './families/pickover';
import { POLYNOMIAL_A } from './families/polynomialA';
import { POLYNOMIAL_B } from './families/polynomialB';

export const FAMILIES: Record<string, AttractorFamily> = {
  lorenz: LORENZ,
  lorenz_84: LORENZ_84,
  pickover: PICKOVER,
  polynomial_a: POLYNOMIAL_A,
  polynomial_b: POLYNOMIAL_B,
};

export function getFamily(system: string): AttractorFamily | null {
  return FAMILIES[system] ?? null;
}
