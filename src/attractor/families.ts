import type { AttractorFamily } from './gpgpu';
import { LORENZ } from './families/lorenz';
import { LORENZ_84 } from './families/lorenz84';
import { PICKOVER } from './families/pickover';

export const FAMILIES: Record<string, AttractorFamily> = {
  lorenz: LORENZ,
  lorenz_84: LORENZ_84,
  pickover: PICKOVER,
};

export function getFamily(system: string): AttractorFamily | null {
  return FAMILIES[system] ?? null;
}
