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

// Incendia Flow (the 124 single-transform .par days -- see docs/superpowers/specs/
// 2026-07-25-incendia-flow-design.md): a single affine map has no chaos-game attractor
// structure to settle onto, just a fixed point, so this shows the honest transient dynamics
// instead -- every particle repeatedly applies the SAME one transform (IFS's existing
// stepAttractor already does this correctly for a single 13-float block: the weighted-random
// selection trivially always picks block 0), with a small per-frame chance of respawning at a
// fresh position (randomReseed) so a contractive map's particles don't all collapse to one
// static point and go still. Calibrated against the real 124-day corpus (see the spec): chance
// 0.003 (~0.3% per frame, average particle lifetime ~333 frames/~5.5s at 60fps) and
// radiusMultiplier 15 (reseed cube half-width = 15 * the transform's own translation length) are
// starting values, tunable visually -- see the spec's Task 7 calibration notes for final values.
export const INCENDIA_FLOW: AttractorFamily = {
  ...IFS,
  system: 'incendia_flow',
  randomReseed: { chance: 0.003, radiusMultiplier: 15 },
};
