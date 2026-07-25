import type { AttractorFamily } from '../gpgpu';
import { IFS } from './ifs';

// Incendia IFS (phase 2c): pipeline/incendia.mjs decodes each .par transform (confirmed
// column-major 3x3 linear + translation + weight — see that file's header) and composes
// directly into the exact same live stride-13 [M(9 row-major), t(3), w(1)] format IFS's
// glslStep/ifsCpuStep already consume, weights already normalized. Unlike Chaoscope's ifs
// (whose 16-float file format encodes an editable rotation/scale/shear/translation
// decomposition worth preserving raw — see families/ifs.ts), Incendia's raw block has no such
// decomposition to keep separate, so the pipeline composes once at the source instead of
// shipping a raw form for a client-side compose step: attractor.params IS the live form
// already. The runtime step is therefore identical to ifs; only the data source differs, so
// this reuses IFS's shader/disturb wholesale rather than duplicate it.
export const INCENDIA_IFS: AttractorFamily = { ...IFS, system: 'incendia_ifs' };
