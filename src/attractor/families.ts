import type { AttractorFamily } from './gpgpu';
import { LORENZ } from './families/lorenz';

export const FAMILIES: Record<string, AttractorFamily> = {
  lorenz: LORENZ,
};

export function getFamily(system: string): AttractorFamily | null {
  return FAMILIES[system] ?? null;
}
