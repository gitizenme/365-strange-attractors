import type { AttractorFamily } from './gpgpu';
import { LORENZ } from './families/lorenz';
import { LORENZ_84 } from './families/lorenz84';

export const FAMILIES: Record<string, AttractorFamily> = {
  lorenz: LORENZ,
  lorenz_84: LORENZ_84,
};

export function getFamily(system: string): AttractorFamily | null {
  return FAMILIES[system] ?? null;
}
