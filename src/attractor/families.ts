import type { AttractorFamily } from './gpgpu';
import { LORENZ } from './families/lorenz';
import { LORENZ_84 } from './families/lorenz84';
import { PICKOVER } from './families/pickover';
import { POLYNOMIAL_A } from './families/polynomialA';
import { POLYNOMIAL_B } from './families/polynomialB';
import { CHAOTIC_FLOW } from './families/chaoticFlow';
import { POLYNOMIAL_C } from './families/polynomialC';
import { POLYNOMIAL_FUNC } from './families/polynomialFunc';
import { POLYNOMIAL_SPROTT } from './families/polynomialSprott';
import { IFS } from './families/ifs';
import { ICON } from './families/icon';

export const FAMILIES: Record<string, AttractorFamily> = {
  lorenz: LORENZ,
  lorenz_84: LORENZ_84,
  pickover: PICKOVER,
  polynomial_a: POLYNOMIAL_A,
  polynomial_b: POLYNOMIAL_B,
  chaotic_flow: CHAOTIC_FLOW,
  polynomial_c: POLYNOMIAL_C,
  polynomial_func: POLYNOMIAL_FUNC,
  polynomial_sprott: POLYNOMIAL_SPROTT,
  ifs: IFS,
  icon: ICON,
};

export function getFamily(system: string): AttractorFamily | null {
  return FAMILIES[system] ?? null;
}
