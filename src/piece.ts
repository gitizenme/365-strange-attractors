import * as THREE from 'three';
import type { Artwork } from './data';
import { imageUrl, dayToDate } from './data';
import { getFamily } from './attractor/families';
import { normalizeFuncParams } from './attractor/families/polynomialFunc';
import { LiveAttractor, type SeedSpec } from './attractor/gpgpu';
import { pickTintColor } from './attractor/palette';
import { pickTier } from './attractor/tiers';
import { initialOrbitState, applyOrbitDrag, applyOrbitZoom, orbitCameraPosition, type OrbitState } from './attractor/orbit';
import type { Attractor } from './data';
import type { Controls } from './controls';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Known mathematically degenerate for their one real-world parameter set.
//
// Task 7 originally found (and Task 12.5 has since RE-CHECKED and REVERSED for two of these --
// see below): polynomial_a (day 72) and polynomial_b (day 41) both looked degenerate. That
// finding was correct for the formula Task 7 had shipped at the time (a guessed 1D/2D
// delay-embedded quadratic recurrence: day 72 had no real fixed point and diverged to infinity
// for every starting value; day 41 collapsed to a single attracting fixed point within ~150
// iterations) -- but Task 12.5 (see .superpowers/sdd/task-12.5-report.md) replaced that guessed
// formula with Chaoscope's own documented 3-variable cyclic formula (confirmed against the
// manual's equation images by two independent investigations) and re-tested both real days under
// it: BOTH now produce genuinely bounded, structured, chaotic results (CPU-confirmed: no
// divergence, no fixed-point collapse, positive empirical Lyapunov estimate) and both were
// browser-verified. Both are therefore REMOVED from this set below -- they are no longer
// degenerate, the earlier formula was simply wrong for these two specific families.
//
// Remaining entries (34, 5) are unrelated families where the underlying degeneracy was checked
// against Chaoscope's real documented formula from the start and still holds; the GPU NaN-guard
// resets in-shader rather than raising, so skip live construction explicitly rather than showing
// a broken "Hide Image" toggle for a flickering-noise or invisible cloud:
// - polynomial_func day 34 (034-infinity): CPU-checked from 40 widely-spread random starting
//   points (range [-2,2]^3, 8000-step settle) -- ALL converge to the same true fixed point
//   (zero extent over 3000 sampled steps from every start), under the manual-confirmed Sin
//   variant formula (Task 12).
// - polynomial_sprott day 5 (005-transmission, this family's only in-scope real day): the
//   formula's degree-2 structure is directly confirmed against Chaoscope's own documented
//   equation image, but the degree 3-5 term ordering is NOT independently documented anywhere
//   found -- it's a principled reconstruction (see polynomialSprott.ts's header comment) that
//   exactly reproduces the one confirmed (degree-2) case. Under that reconstruction, this real
//   day's actual 168 coefficients diverge to infinity within ~7-14 iterations from every tested
//   starting point (including many very close to the origin), and neither of the plan brief's
//   suggested damping fallbacks produces a stable, non-collapsed result (mild damping still
//   diverges; stronger damping instead collapses to a fixed point -- no bounded chaotic window
//   was found between those two regimes). Skipping live construction here rather than shipping
//   a formula known not to work for this family's only real calibration day.
const KNOWN_DEGENERATE_DAYS = new Set([34, 5]);

export function neighborDay(day: number, dir: 1 | -1): number {
  return ((day - 1 + dir + 365) % 365) + 1;
}

export function captionFor(a: { day: number; title: string }): string {
  const { month, date } = dayToDate(a.day);
  return `${String(a.day).padStart(3, '0')}/365 · ${a.title} · ${MONTHS[month - 1]} ${date}, 2010`;
}

// Deliberately conservative: per the spec's adjacency finding, only 6 day-pairs in the whole
// archive are same-family adjacent (share a `system` and neither is 'static-only'), so those
// are the only ones worth the parameter-interpolation morph; everything else — different
// family, either side static-only or unknown — falls back to the plain dissolve (open()'s
// existing dispose/reconstruct cycle).
export function transitionKind(
  current: { day: number; system: string } | null,
  next: { day: number; system: string } | null,
): 'morph' | 'dissolve' {
  if (!current || !next) return 'dissolve';
  if (current.system === 'static-only' || next.system === 'static-only') return 'dissolve';
  return current.system === next.system ? 'morph' : 'dissolve';
}

// Both estimate*Display functions below need the same shape of work: mirror a family's glslStep
// exactly on the CPU, run it forward from a fixed start to settle onto the attractor, then sample
// the settled trajectory to derive (a) a display scale/center from its bounding box (the original
// purpose of this pattern) and (b) a diverse set of real, on-attractor points suitable for seeding
// LiveAttractor's initial GPU texture (gpgpu.ts's SeedSpec) instead of its default near-identical
// random-near-origin fill.
//
// That second use is the fix for a real bug (see .superpowers/sdd/task-11.5-report.md): for
// slow-mixing systems (small dt, or attractors whose nearby trajectories take a long time to
// decorrelate), seeding ~1M GPU points from near-identical random starts means the whole cloud
// only visually "fills in" the true attractor shape as fast as the system's own mixing timescale —
// which can be minutes of wall-clock viewing time, not seconds (concretely, chaotic_flow day
// 025-sometimes-chaos). A single CPU trajectory of a few thousand steps is cheap (well under a
// millisecond) and, being one long ergodic run rather than ~1M parallel near-identical ones,
// naturally visits the attractor's true shape — so sampling real points from it and replicating
// them (with light jitter) across the GPU texture makes the very first rendered frame already look
// like a populated attractor.
function sampleSettledTrajectory(
  step: () => void,
  state: { x: number; y: number; z: number },
  settleSteps: number,
  sampleSteps: number,
): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  for (let i = 0; i < settleSteps; i++) step();
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  // Cap how many of the sampled points we actually keep: ~1M GPU texels only need a diverse pool
  // to draw from, not one entry per texel (they're picked randomly with replacement — see
  // gpgpu.ts's fillSeedTexture) — a few thousand distinct points is already plenty of diversity
  // and keeps this array small.
  const SEED_SAMPLE_CAP = 4096;
  const stride = Math.max(1, Math.floor(sampleSteps / SEED_SAMPLE_CAP));
  const seedPoints: number[] = [];
  for (let i = 0; i < sampleSteps; i++) {
    step();
    if (!isFinite(state.x) || !isFinite(state.y) || !isFinite(state.z)) break;
    minX = Math.min(minX, state.x); maxX = Math.max(maxX, state.x);
    minY = Math.min(minY, state.y); maxY = Math.max(maxY, state.y);
    minZ = Math.min(minZ, state.z); maxZ = Math.max(maxZ, state.z);
    if (i % stride === 0) seedPoints.push(state.x, state.y, state.z);
  }
  const TARGET_HALF_EXTENT = 4; // fits comfortably inside the orbit camera's default frustum (radius 10, 50deg fov => visible half-height ~4.66)
  // Half-extent from each axis's own SPAN (max-min), not from maxAbs (distance from the origin).
  // Those agree only when the shape happens to be centered near the origin -- true for most
  // families here, but day 012-green-leafs (polynomial_func, sin variant) settles onto a small
  // ~0.5-unit blob sitting far off-origin (center ~(-4.4, -1.4, 1.25)): maxAbs was dominated by
  // that offset (~4.76) rather than the blob's actual size, so the old formula scaled the cloud
  // down to fit its DISTANCE from the origin instead of its own extent, and only centerZ (not
  // centerX/centerY) recentered it -- producing a tiny, off-center cloud. Span-based half-extent
  // plus recentering all three axes fixes both problems and is a no-op for shapes already
  // centered near the origin (span/2 == maxAbs there).
  const halfExtent = Math.max(
    isFinite(maxX) && isFinite(minX) ? (maxX - minX) / 2 : 0,
    isFinite(maxY) && isFinite(minY) ? (maxY - minY) / 2 : 0,
    isFinite(maxZ) && isFinite(minZ) ? (maxZ - minZ) / 2 : 0,
  );
  const scale = halfExtent > 0.001 ? TARGET_HALF_EXTENT / halfExtent : 1;
  const centerX = isFinite(minX) && isFinite(maxX) ? (minX + maxX) / 2 : 0;
  const centerY = isFinite(minY) && isFinite(maxY) ? (minY + maxY) / 2 : 0;
  const centerZ = isFinite(minZ) && isFinite(maxZ) ? (minZ + maxZ) / 2 : 0;
  // Jitter scales with the attractor's own extent (1% of its largest axis span) rather than a
  // flat constant or (as before) maxAbs -- same off-origin reasoning as halfExtent above applies
  // here too, otherwise an off-origin day's jitter would be sized to its distance from the origin
  // rather than its own footprint.
  const jitter = halfExtent > 0.001 ? halfExtent * 2 * 0.01 : 0.05;
  return { scale, centerX, centerY, centerZ, seed: { points: Float32Array.from(seedPoints), jitter } };
}

// Lorenz-84's natural coordinate range varies a lot from day to day (empirically, half-extents
// across this dataset's lorenz_84 days range from ~3 to ~20 world units depending on a/b/F/G),
// unlike classic Lorenz where a single flat display scale works because rho is the only param
// that materially changes across days and its fixed-point spacing has a simple closed form
// (rho - 1). There's no equivalent closed form for Lorenz-84, and empirical testing in-browser
// confirmed a single flat constant either shrinks the small days to near-invisible dots or
// leaves the large days (e.g. 006-goblet-of-light, half-extent ~14) entirely outside the orbit
// camera's frustum, even at max zoom-out (radius 30). Instead, cheaply simulate the same
// equations as lorenz84.ts's glslStep on the CPU (a few thousand float ops, sub-millisecond)
// once per open() to estimate this specific day's bounding extent, then derive a scale/centerZ
// from that so the cloud lands inside the default framing regardless of parameters.
//
// (lorenz_84's live cloud was checked empirically for the same slow-mixing seeding bug that
// chaotic_flow has — see task-11.5-report.md — and does NOT show it: a many-parallel-trajectory
// CPU simulation of this dataset's two smallest-dt lorenz_84 days, 015-eye-of-the-storm and
// 084-cool-wave (dt=0.002, matching chaotic_flow day 025's order of magnitude), reaches ~95-99%
// of its long-run extent within the app's existing shipped prewarm budget. The `seed` field on
// the returned value is still populated — same shared helper — but piece.ts's open() does not
// currently pass it to LiveAttractor for this family, since there's no measured benefit and doing
// so would be an untested code path for an already-working family.)
export function estimateLorenz84Display(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const [a, b, F, G, dt] = params;
  const state = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => {
    const dx = -state.y * state.y - state.z * state.z - a * state.x + a * F;
    const dy = state.x * state.y - b * state.x * state.z - state.y + G;
    const dz = b * state.x * state.y + state.x * state.z - state.z;
    state.x += dx * dt; state.y += dy * dt; state.z += dz * dt;
  };
  return sampleSettledTrajectory(step, state, 2000, 2000);
}

// chaotic_flow's natural extent varies even more than lorenz_84's across this dataset's 17 days
// (empirically, CPU pre-simulation of all 17 gives half-extents from ~1 to ~40+ world units —
// see Task 11 report) because the family's per-day parameters don't just scale a fixed equation
// shape, they change which variable each of the 9 matrix terms multiplies (see chaoticFlow.ts's
// header comment for the Op-selector mechanism), so there's no closed-form relationship between
// the raw parameters and the resulting attractor's size. Reuse the same CPU pre-simulation
// strategy as estimateLorenz84Display: mirror chaoticFlow.ts's glslStep exactly on the CPU and
// measure the actual settled bounding extent for this specific day's params.
//
// Sample steps are doubled relative to estimateLorenz84Display's (4000 vs 2000): empirically
// validated in task-11.5-report.md across all 17 chaotic_flow days, seeding LiveAttractor from
// this function's `seed` output brings the live cloud to ~79-170% of its long-run extent within
// the *existing* shipped prewarm budget for every day, including 025-sometimes-chaos (was ~3%
// under the old random-near-origin seeding) — and the extra sample steps cost well under a
// millisecond of CPU time (measured), nowhere near the multi-second freeze a naive "just run more
// GPU settling steps" fix would have caused.
export function estimateChaoticFlowDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const c = params;
  const dT = c[21];
  const opVar = (idx: number, x: number, y: number, z: number) => {
    const i = Math.round(idx);
    if (i <= 0) return 1;
    if (i === 1) return x;
    if (i === 2) return y;
    return z;
  };
  const state = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => {
    const { x, y, z } = state;
    const dx = c[0] * opVar(c[1], x, y, z) * x + c[2] * opVar(c[3], x, y, z) * y + c[4] * opVar(c[5], x, y, z) * z + c[6];
    const dy = c[7] * opVar(c[8], x, y, z) * x + c[9] * opVar(c[10], x, y, z) * y + c[11] * opVar(c[12], x, y, z) * z + c[13];
    const dz = c[14] * opVar(c[15], x, y, z) * x + c[16] * opVar(c[17], x, y, z) * y + c[18] * opVar(c[19], x, y, z) * z + c[20];
    state.x += dx * dT; state.y += dy * dT; state.z += dz * dT;
  };
  return sampleSettledTrajectory(step, state, 2000, 4000);
}

// polynomial_c converges fast (CPU check: both real days reach ~95-99% of their long-run extent
// within the 150-step budget LiveAttractor's constructor already runs), so this isn't fixing a
// slow-mixing bug the way chaotic_flow's version does -- it's here because the family's two real
// days still have a ~2.5x different natural scale (half-extents ~1.4 vs ~2.6-3.4 units), so a
// single flat constant (like Lorenz's/Pickover's) would leave one day's cloud visibly
// under/over-sized relative to the other. Mirrors polynomialC.ts's glslStep exactly.
export function estimatePolynomialCDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const c = params;
  const state = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => {
    const { x, y, z } = state;
    const nx = c[0] + x * (c[1] + c[2] * x + c[3] * y) + y * (c[4] + c[5] * y);
    const ny = c[6] + y * (c[7] + c[8] * y + c[9] * z) + z * (c[10] + c[11] * z);
    const nz = c[12] + z * (c[13] + c[14] * z + c[15] * x) + x * (c[16] + c[17] * x);
    state.x = nx; state.y = ny; state.z = nz;
  };
  return sampleSettledTrajectory(step, state, 3000, 3000);
}

// polynomial_a and polynomial_b (CORRECTED formulas, Task 12.5 -- see task-12.5-report.md and
// each family file's header comment for the full story). Both families' one real day (072 for A,
// 041 for B) turned out mathematically degenerate under Task 7's originally-shipped guessed
// formula (072 diverged to infinity from every start, 041 collapsed to a fixed point), so both
// were excluded via KNOWN_DEGENERATE_DAYS. Under the corrected, Chaoscope-manual-confirmed
// formula, CPU pre-simulation of both real days' actual parameters shows a genuinely bounded,
// structured, chaotic result instead: maxAbs settles to ~2.48 (both families), no close-fitting
// low-period (<=20) cycle, and a positive empirically-estimated Lyapunov exponent (~0.10/step,
// nearby trajectories separate exponentially) -- the opposite of both original degeneracies. Both
// are re-enabled below (removed from KNOWN_DEGENERATE_DAYS) and given the same per-day CPU
// estimation treatment as polynomial_c, for the same reason: with only one real day each there's
// no way yet to know if a flat constant would generalize, and the per-day estimator costs nothing
// (sub-millisecond) and is already the established pattern for this family group.
//
// One wrinkle specific to polynomial_a: unlike every other estimator in this file, this one does
// NOT start from the shared (0.1, 0.1, 0.1) convention. For day 072's actual parameters, that
// exact point sits close enough to this map's divergent-basin boundary that it shoots to infinity
// within ~20 iterations (confirmed by direct simulation) -- but this is a razor-thin fluke of that
// one specific point, not evidence of a fragile/degenerate basin: a sweep of 2000 random starting
// points uniformly distributed in [-0.05, 0.05]^3 (matching gpgpu.ts's actual default GPU seed
// range) showed 0/2000 diverging, and every other individually-tested nearby start (including the
// origin) lands on the same bounded attractor described above. Starting from the origin instead
// sidesteps that one unlucky point without changing anything about how the real day behaves.
// polynomial_b's day 041 has no such issue -- (0.1, 0.1, 0.1) converges fine -- but the origin is
// used for it too, for consistency between the two files.
export function estimatePolynomialADisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const [P0, P1, P2] = params;
  const state = { x: 0, y: 0, z: 0 };
  const step = () => {
    const { x, y, z } = state;
    const nx = P0 + y - z * y;
    const ny = P1 + z - x * z;
    const nz = P2 + x - y * x;
    state.x = nx; state.y = ny; state.z = nz;
  };
  return sampleSettledTrajectory(step, state, 3000, 3000);
}

export function estimatePolynomialBDisplay(params: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const [P0, P1, P2, P3, P4, P5] = params;
  const state = { x: 0, y: 0, z: 0 };
  const step = () => {
    const { x, y, z } = state;
    const nx = P0 + y - z * (P1 + y);
    const ny = P2 + z - x * (P3 + z);
    const nz = P4 + x - y * (P5 + x);
    state.x = nx; state.y = ny; state.z = nz;
  };
  return sampleSettledTrajectory(step, state, 3000, 3000);
}

// polynomial_func's natural extent varies enormously across this dataset's 6 real days -- CPU
// pre-simulation gives half-extents from under 1 unit (034-infinity, which converges to a fixed
// point -- see KNOWN_DEGENERATE_DAYS-adjacent handling) up to several hundred/low-thousands of
// units (064-coma), a >1000x spread, so a flat constant is a non-starter (see the analogous
// reasoning for lorenz_84/chaotic_flow above). It also needs the same slow-to-populate fix
// chaotic_flow got in task-11.5: 064-coma's CPU check shows the live cloud reaches only ~20% of
// its long-run extent within LiveAttractor's fixed 150-step constructor settle (vs. ~75-105% for
// the other 5 real days) -- not because of slow mixing/decorrelation like chaotic_flow's small-dt
// days, but because this is a large-extent expanding map that simply takes more than 150
// iterations to reach its natural scale from a near-origin start, and since ~1M GPU texels all
// start near-identical, they'd all lag behind in lockstep the same way. Seeding from a real
// pre-sampled trajectory (this function's `seed` output) sidesteps that the same way it did for
// chaotic_flow. Mirrors polynomialFunc.ts's glslStep exactly (operating on already-normalized
// 40-slot params -- see normalizeFuncParams).
export function estimatePolynomialFuncDisplay(rawParams: number[]): { scale: number; centerX: number; centerY: number; centerZ: number; seed: SeedSpec } {
  const c = normalizeFuncParams(rawParams);
  const variant = c[39];
  const state = { x: 0.1, y: 0.1, z: 0.1 };
  const step = () => {
    const { x, y, z } = state;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let nx: number, ny: number, nz: number;
    if (variant < 0.5) {
      nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*ax + c[5]*ay + c[6]*az;
      ny = c[7] + c[8]*x + c[9]*y + c[10]*z + c[11]*ax + c[12]*ay + c[13]*az;
      nz = c[14] + c[15]*x + c[16]*y + c[17]*z + c[18]*ax + c[19]*ay + c[20]*az;
    } else if (variant < 1.5) {
      nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*ax + c[5]*ay + c[6]*Math.pow(az, c[7]);
      ny = c[8] + c[9]*x + c[10]*y + c[11]*z + c[12]*ax + c[13]*ay + c[14]*Math.pow(az, c[15]);
      nz = c[16] + c[17]*x + c[18]*y + c[19]*z + c[20]*ax + c[21]*ay + c[22]*Math.pow(az, c[23]);
    } else {
      nx = c[0] + c[1]*x + c[2]*y + c[3]*z + c[4]*Math.sin(c[5]*c[6]*x) + c[7]*Math.sin(c[8]*c[9]*y) + c[10]*Math.sin(c[11]*c[12]*z);
      ny = c[13] + c[14]*x + c[15]*y + c[16]*z + c[17]*Math.sin(c[18]*c[19]*x) + c[20]*Math.sin(c[21]*c[22]*y) + c[23]*Math.sin(c[24]*c[25]*z);
      nz = c[26] + c[27]*x + c[28]*y + c[29]*z + c[30]*Math.sin(c[31]*c[32]*x) + c[33]*Math.sin(c[34]*c[35]*y) + c[36]*Math.sin(c[37]*c[38]*z);
    }
    state.x = nx; state.y = ny; state.z = nz;
  };
  return sampleSettledTrajectory(step, state, 3000, 3000);
}

// One entry point for "how should this family's live cloud be scaled/positioned/seeded," instead
// of open() re-deriving it via a chain of `attractor.system === X ? estimateX(...) : null` calls
// followed by two parallel scale/centerZ ternaries walking the same chain again (the shape that
// had accumulated by Task 12.5 — each new family added another line to three different places).
// The individual estimate*Display functions above stay as their own exported, independently
// tested units (see tests/piece-display.test.ts) — this only consolidates how open() dispatches
// to them.
interface DisplayResult { scale: number; centerX: number; centerY: number; centerZ: number; seed?: SeedSpec }

// Lorenz's two chaotic lobes straddle fixed points at local z ≈ rho - 1 (not local z ≈ 0), and its
// natural coordinate scale (fixed points ~8.5 units apart, full chaotic spread tens of units) is
// much larger than orbit.ts's fixed default view radius (10, clamped to [3, 30]) — see the fuller
// explanation this comment used to carry, now folded into the registry entry below.
const LORENZ_DISPLAY_SCALE = 0.2;
// Pickover's sin/cos-built map bounds its coordinates to roughly [-1.2, 1.2] regardless of params
// (empirically confirmed across both real days — see the registry entry below), unlike lorenz_84's
// ~6x day-to-day spread, so a flat constant works fine here.
const PICKOVER_DISPLAY_SCALE = 3.2;

const DISPLAY_ESTIMATORS: Record<string, (params: number[]) => DisplayResult> = {
  // Closed-form scale/centerZ (see the constants' comments above) — no CPU pre-simulation needed,
  // unlike every other family below.
  lorenz: params => ({ scale: LORENZ_DISPLAY_SCALE, centerX: 0, centerY: 0, centerZ: params.length >= 2 ? params[1] - 1 : 0 }),
  pickover: () => ({ scale: PICKOVER_DISPLAY_SCALE, centerX: 0, centerY: 0, centerZ: 0 }),
  // lorenz_84 deliberately drops its own computed `seed`: checked empirically against this
  // dataset's smallest-dt days and found NOT to show the slow-mixing bug chaotic_flow has (see
  // estimateLorenz84Display's header comment), so passing it would be an untested code path for an
  // already-working family, not a fix for anything.
  lorenz_84: params => ({ ...estimateLorenz84Display(params), seed: undefined }),
  chaotic_flow: estimateChaoticFlowDisplay,
  polynomial_c: estimatePolynomialCDisplay,
  polynomial_func: estimatePolynomialFuncDisplay,
  polynomial_a: estimatePolynomialADisplay,
  polynomial_b: estimatePolynomialBDisplay,
  // Every other in-scope family (currently none — all 7 live families in this dataset are listed
  // above) falls through to open()'s { scale: 1, centerZ: 0, seed: undefined } default.
};

export interface LiveDeps {
  attractors: Attractor[];
  renderer: THREE.WebGLRenderer;
  liveScene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  controls: Controls;
  hideImageBtn: HTMLButtonElement;
  brightnessSlider: HTMLInputElement;
}

const BRIGHTNESS_KEY = 'la-brightness';
function loadBrightness(): number {
  const v = Number(localStorage.getItem(BRIGHTNESS_KEY));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export class PieceView {
  private root: HTMLDivElement;
  private img: HTMLImageElement;
  private sources: { avif: HTMLSourceElement; webp: HTMLSourceElement };
  private caption: HTMLElement;
  private current: Artwork | null = null;
  private bySlug: Map<string, Artwork>;
  private byDay: Map<number, Artwork>;

  private live_!: LiveDeps;
  private attractorsByDay = new Map<number, Attractor>();
  private tier: 256 | 1024 | 2048 | null = null;
  private liveAttractor: LiveAttractor | null = null;
  private orbit: OrbitState | null = null;
  private orbitDragging = false;
  private orbitLast = { x: 0, y: 0 };
  private orbitMoved = 0;
  private disturbHeld = false;
  private disturbAmount = 0;
  private brightness = loadBrightness();

  constructor(private overlay: HTMLElement, artworks: Artwork[],
              private onNavigate: (slug: string) => void, private onClose: () => void, live: LiveDeps) {
    this.bySlug = new Map(artworks.map(a => [a.slug, a]));
    this.byDay = new Map(artworks.map(a => [a.day, a]));
    this.root = document.createElement('div');
    this.root.className = 'piece hidden';
    // prev/figure/next live inside .piece-backdrop (the thing that actually fades in/out and
    // paints the dimming background) rather than directly under .piece -- .piece-close stays a
    // direct child of .piece, OUTSIDE that wrapper. This is a fix for a stacking-context bug (see
    // style.css's comments on .piece/.piece-backdrop/.piece-close): an element with opacity < 1
    // creates its own stacking context that traps its descendants' z-index values, so while
    // .piece-backdrop was still .piece itself and had `transition: opacity`, .piece-close's
    // z-index (needed to beat #time-toggle, which sits in nearly the same corner) was briefly
    // trapped and ineffective during every fade-in, letting #time-toggle steal the click. Moving
    // the fading backdrop to a sibling wrapper and giving .piece-close its own independent opacity
    // transition (style.css) means .piece-close is never a descendant of anything that's
    // opacity-animating, so its z-index always compares directly against #time-toggle's.
    this.root.innerHTML = `
      <div class="piece-backdrop">
        <button class="piece-nav prev" aria-label="Previous day" title="Previous day">‹</button>
        <figure>
          <picture>
            <source type="image/avif" /><source type="image/webp" />
            <img alt="" />
          </picture>
          <figcaption></figcaption>
        </figure>
        <button class="piece-nav next" aria-label="Next day" title="Next day">›</button>
      </div>
      <button class="piece-close" aria-label="Close" title="Close">×</button>`;
    overlay.appendChild(this.root);
    const backdrop = this.root.querySelector('.piece-backdrop')!;
    const [avif, webp] = this.root.querySelectorAll('source');
    this.sources = { avif, webp };
    this.img = this.root.querySelector('img')!;
    this.caption = this.root.querySelector('figcaption')!;
    this.root.querySelector('.prev')!.addEventListener('click', () => this.nav(-1));
    this.root.querySelector('.next')!.addEventListener('click', () => this.nav(1));
    this.root.querySelector('.piece-close')!.addEventListener('click', () => this.requestClose());
    // .piece-backdrop now fills the exact same box .piece itself used to (see style.css) and sits
    // on top of it, so a background click lands with e.target === backdrop, not === this.root --
    // both must be treated as "clicked outside the figure/nav/close" to keep this working.
    this.root.addEventListener('click', e => { if (e.target === this.root || e.target === backdrop) this.requestClose(); });
    addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.requestClose();
      if (e.key === 'ArrowLeft') this.nav(-1);
      if (e.key === 'ArrowRight') this.nav(1);
    });
    this.live_ = live;
    live.brightnessSlider.value = String(this.brightness);
    live.brightnessSlider.addEventListener('input', () => {
      this.brightness = Number(live.brightnessSlider.value);
      localStorage.setItem(BRIGHTNESS_KEY, String(this.brightness));
      this.liveAttractor?.setBrightness(this.brightness);
    });
    this.attractorsByDay = new Map(live.attractors.map(a => [a.day, a]));
    this.tier = pickTier({
      webgl2: live.renderer.capabilities.isWebGL2,
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
    this.bindOrbitEvents();
  }

  private bindOrbitEvents(): void {
    const canvas = this.live_.canvas;
    canvas.addEventListener('pointerdown', e => {
      if (!this.liveAttractor) return;
      if ((e.target as HTMLElement).closest('button')) return;
      this.orbitDragging = true;
      this.orbitLast = { x: e.clientX, y: e.clientY };
      this.orbitMoved = 0;
      // The disturb-hold gesture (Task 8) starts tentatively on this same pointerdown, since a
      // press that stays put is disturb intent from the first frame — but the pointermove handler
      // below cuts `disturbHeld` back off once cumulative movement crosses a 5px threshold, so a
      // real drag (orbit intent) doesn't also ramp the perturbation. This mirrors controls.ts's
      // Controls class, which uses the same 5px cumulative-movement threshold to tell a tap from a
      // drag (see its `moved` field) — applied continuously here rather than judged once at
      // pointerup, since disturb needs to stop ramping the moment the threshold is crossed, not
      // retroactively at release. Note this listener lives on the canvas, not the piece root: while
      // a live attractor is showing, the root's CSS switches to pointer-events:none (see the
      // `.piece.live-active` rule in style.css) specifically so drag/press input passes through to
      // this canvas — a listener on the root itself would only ever see clicks on the nav/close
      // buttons, never a press in the middle of the cloud.
      this.disturbHeld = true;
    });
    addEventListener('pointermove', e => {
      if (!this.liveAttractor || !this.orbitDragging || !this.orbit) return;
      const dx = e.clientX - this.orbitLast.x;
      const dy = e.clientY - this.orbitLast.y;
      this.orbit = applyOrbitDrag(this.orbit, dx, dy);
      this.orbitLast = { x: e.clientX, y: e.clientY };
      this.orbitMoved += Math.hypot(dx, dy);
      if (this.orbitMoved > 5) this.disturbHeld = false;
    });
    addEventListener('pointerup', () => { this.orbitDragging = false; this.disturbHeld = false; });
    canvas.addEventListener('wheel', e => {
      if (!this.liveAttractor || !this.orbit) return;
      e.preventDefault();
      this.orbit = applyOrbitZoom(this.orbit, e.deltaY);
    }, { passive: false });
  }

  private nav(dir: 1 | -1): void {
    if (!this.current) return;
    const next = this.byDay.get(neighborDay(this.current.day, dir))!;
    const curAttr = this.attractorsByDay.get(this.current.day);
    const nextAttr = this.attractorsByDay.get(next.day);
    const kind = transitionKind(
      curAttr ? { day: curAttr.day, system: curAttr.system } : null,
      nextAttr ? { day: nextAttr.day, system: nextAttr.system } : null,
    );
    if (kind === 'morph' && this.liveAttractor && nextAttr?.params) {
      // Capture the live instance we're morphing so a stale rAF tick can never touch a
      // *different* (disposed-and-replaced) instance — see the guard inside step() below.
      const morphing = this.liveAttractor;
      morphing.setMorphTarget(nextAttr.params, 0);
      const start = performance.now();
      const step = () => {
        // open()/close() may have already disposed this exact instance and swapped in a new
        // one (or none) for the next day before this tween finished — e.g. a rapid double-tap
        // of the nav arrow. Bail rather than mutate a disposed GPUComputationRenderer.
        if (this.liveAttractor !== morphing) return;
        const t = Math.min(1, (performance.now() - start) / 800);
        morphing.setMorphTarget(nextAttr.params!, t);
        if (t < 1) requestAnimationFrame(step);
        else { morphing.setParams(nextAttr.params!); morphing.setMorphTarget(null, 0); }
      };
      requestAnimationFrame(step);
    }
    // main.ts's router awaits controls.flyTo(...) (tweening the shared camera's position over
    // ~0.9s) BEFORE calling piece.open(next.slug) — open() isn't called synchronously here, so
    // `this.current`/`this.liveAttractor`/`this.orbit` all still describe the *outgoing* piece
    // for the whole flight. render() repositions the shared camera from `this.orbit` every
    // frame via its own lookAt() (Task 4/8), which — left as-is — fights flyTo's own per-frame
    // position tween for control of the same camera for that entire ~0.9s (Task 4's disclosed
    // risk: two independent rAF loops writing camera.position/quaternion the same frame,
    // ordering-dependent jitter). Clear `orbit` so render()'s `if (this.liveAttractor &&
    // this.orbit)` guard skips the camera write for the remainder of the flight, leaving flyTo
    // as the sole owner of the camera; the outgoing point cloud (and, for 'morph', its running
    // tween) keeps simulating/rendering in place, uncoupled from the camera, which reads as the
    // dissolve/morph "left behind" as the view moves on. open() sets a fresh `orbit` for the
    // next piece once flyTo resolves, healing this back to normal.
    this.orbit = null;
    this.onNavigate(next.slug);
  }

  private requestClose(): void { this.close(); this.onClose(); }

  open(slug: string): void {
    const a = this.bySlug.get(slug);
    if (!a) return;
    this.current = a;
    const srcset = (ext: 'avif' | 'webp' | 'jpg') =>
      `${imageUrl(a.slug, 1024, ext)} 1024w, ${imageUrl(a.slug, 2000, ext)} 2000w`;
    this.sources.avif.srcset = srcset('avif');
    this.sources.webp.srcset = srcset('webp');
    this.img.srcset = srcset('jpg');
    this.img.src = imageUrl(a.slug, 1024, 'jpg');
    this.img.alt = `${a.title} — strange attractor, day ${a.day} of 365, 2010`;
    this.caption.textContent = captionFor(a);
    this.root.classList.remove('hidden');
    // preload neighbors
    for (const dir of [1, -1] as const) {
      const n = this.byDay.get(neighborDay(a.day, dir))!;
      new Image().src = imageUrl(n.slug, 1024, 'jpg');
    }

    this.liveAttractor?.dispose();
    this.liveAttractor = null;
    const attractor = this.attractorsByDay.get(a.day);
    const family = attractor && attractor.system !== 'static-only' ? getFamily(attractor.system) : null;
    if (family && attractor?.params && this.tier && !KNOWN_DEGENERATE_DAYS.has(a.day)) {
      try {
        // See DISPLAY_ESTIMATORS above (and each estimate*Display function it wraps) for why each
        // family's scale/centerZ/seed is what it is. Families with no entry (currently none — all
        // 7 live families here have one) fall back to an unscaled, uncentered, unseeded default.
        const display = DISPLAY_ESTIMATORS[attractor.system]?.(attractor.params) ?? { scale: 1, centerX: 0, centerY: 0, centerZ: 0 };
        const liveSeed = display.seed && display.seed.points.length >= 3 ? display.seed : undefined;
        // polynomial_func's real archive days have 3 genuinely different underlying parameter-
        // list lengths (21/24/39 — see polynomialFunc.ts's header comment for why), but
        // AttractorFamily/LiveAttractor need one fixed-size params array matching paramCount.
        // normalizeFuncParams pads/tags the raw params into that fixed 40-slot shape; every
        // other family passes its raw params through unchanged.
        const liveParams = attractor.system === 'polynomial_func' ? normalizeFuncParams(attractor.params) : attractor.params;
        const tint = pickTintColor(a.palette);
        this.liveAttractor = new LiveAttractor(this.live_.renderer, family, liveParams, this.tier, liveSeed, tint);
        // LiveAttractor's own settling burst (Task 3, fixed at 150 steps) integrates only
        // 150 * dt simulated time units. That's plenty for this dataset's typical dt (~0.03-0.2)
        // but nowhere near enough for the smallest dt found here (e.g. 0.001, the classic-constants
        // reference day): 150 steps only reaches the vicinity of one fixed point, and the two lobes
        // don't visibly separate until ~20 simulated time units of chaotic mixing. Pre-warm further
        // for ODE families so the cloud starts fully formed instead of a barely-moved dot (measured
        // ~0.02ms/iteration, so even the capped worst case here is a sub-second one-time pause).
        if (!family.isDiscreteMap) {
          const dt = attractor.params[attractor.params.length - 1];
          if (dt > 0) {
            const extraSteps = Math.min(20000, Math.ceil(20 / dt));
            for (let i = 0; i < extraSteps; i++) this.liveAttractor.compute();
          }
        }
        // The raw point cloud is generated in its own local attractor-space coordinates and needs
        // translating into this artwork's constellation position so it lines up with where the
        // camera flew to/orbits — recentering all three axes onto that target, since a family's
        // natural cluster isn't always near its own local origin (see DISPLAY_ESTIMATORS above and
        // each estimate*Display function for why each family's scale/center is what it is).
        this.liveAttractor.points.scale.setScalar(display.scale);
        this.liveAttractor.points.position.set(
          a.x - display.scale * display.centerX,
          a.y - display.scale * display.centerY,
          8 - display.scale * display.centerZ,
        );
        this.orbit = initialOrbitState({ x: a.x, y: a.y, z: 8 }); // a.x/a.y = this piece's constellation position; z matches Phase 1's flyTo z target
        // Calibrate against the real opening camera position/framing before the first visible
        // frame — position the shared camera here first (render() below repositions it from
        // `this.orbit` every subsequent frame anyway, so this is just priming it a frame early).
        // Deliberately BEFORE setBrightness(): the material's uBrightness uniform is still at its
        // neutral default (1) here, so calibration measures the tier/geometry-driven saturation
        // this exists to correct, not whatever brightness level was left over from a previously
        // open piece (uBrightness multiplies directly into the rendered color, so measuring at a
        // stale non-1 value would under- or over-correct for this day's own baseline).
        const openPos = orbitCameraPosition(this.orbit);
        this.live_.camera.position.set(openPos.x, openPos.y, openPos.z);
        this.live_.camera.lookAt(this.orbit.target.x, this.orbit.target.y, this.orbit.target.z);
        this.liveAttractor.calibrate(this.live_.renderer, this.live_.camera);
        this.liveAttractor.setBrightness(this.brightness);
        this.live_.liveScene.add(this.liveAttractor.points);
        this.live_.controls.setEnabled(false);
      } catch (err) {
        console.error('live attractor init failed, falling back to static', err);
        this.liveAttractor = null;
        this.orbit = null;
      }
    }
    this.live_.hideImageBtn.style.display = this.liveAttractor ? 'block' : 'none';
    this.live_.brightnessSlider.style.display = this.liveAttractor ? 'block' : 'none';
    // The piece backdrop (Phase 1) is a full-viewport pointer-events:auto element that sits on top
    // of the #gl canvas the whole time the piece is open (it needs to catch clicks on empty space
    // to close, per Phase 1's "click outside figure to close"). That would swallow every drag/wheel
    // event aimed at orbiting the live attractor before it ever reaches bindOrbitEvents' canvas
    // listeners. Toggle a class that makes the backdrop pass events through to the canvas whenever
    // a live attractor is showing, leaving only the actual buttons (nav/close) clickable — see
    // the `.piece.live-active` rules in style.css.
    this.root.classList.toggle('live-active', !!this.liveAttractor);
  }

  close(): void {
    this.liveAttractor?.dispose();
    this.liveAttractor = null;
    this.orbit = null;
    this.disturbHeld = false;
    this.disturbAmount = 0;
    this.live_.controls.setEnabled(true);
    this.live_.hideImageBtn.style.display = 'none';
    this.live_.brightnessSlider.style.display = 'none';
    this.root.classList.remove('live-active');
    this.root.classList.add('hidden');
    this.current = null;
    // The orbit camera (render()) mutates the shared camera's rotation via lookAt() every frame
    // while a live attractor is open. Controls' flat pan/zoom math (screenToWorld, drag, wheel-zoom)
    // assumes an axis-aligned camera looking straight down -Z with no roll/tilt — reset the rotation
    // here so the constellation view isn't left skewed and pan/zoom keep working correctly.
    this.live_.camera.quaternion.identity();
  }

  isOpen(): boolean { return this.current !== null; }

  // True when this device/browser has the WebGL2 + float-texture support LiveAttractor needs
  // (pickTier() returned non-null in the constructor) — NOT whether the currently open day
  // actually has a live cloud showing. A day can be static-only, degenerate (see
  // KNOWN_DEGENERATE_DAYS above), or mid-construction-failure even when this is true, so callers
  // that need "is a live attractor showing right now" should check `this.liveAttractor` (e.g. the
  // hide-image button's visibility below), not this accessor.
  hasLiveSupport(): boolean { return this.tier !== null; }

  // Returns the new state so callers (main.ts's hide-image button) can update their own label to
  // reflect it rather than showing the same text regardless of which action clicking will perform.
  toggleHideStatic(): boolean { return this.root.classList.toggle('hide-static'); }

  // Hide-static persists across day navigation and close/reopen (neither open() nor close() resets
  // it), so main.ts needs to re-sync the button's label after those transitions too, not just right
  // after a click.
  isHidingStatic(): boolean { return this.root.classList.contains('hide-static'); }

  // True when the static image is hidden and a live cloud is actively showing full-brightness —
  // main.ts's render loop uses this to skip drawing the constellation behind the cloud that frame.
  isShowingLiveFullscreen(): boolean {
    return !!this.liveAttractor && this.root.classList.contains('hide-static');
  }

  private updateDisturb(dt: number): void {
    if (!this.liveAttractor) return;
    const target = this.disturbHeld ? 1 : 0;
    const rate = this.disturbHeld ? 1 / 0.3 : 1 / 1.5; // ramp up over 0.3s, ease down over 1.5s
    this.disturbAmount += (target - this.disturbAmount) * Math.min(1, rate * dt);
    this.liveAttractor.setPerturbation(this.disturbAmount);
  }

  render(dt: number): void {
    if (this.liveAttractor && this.orbit) {
      const pos = orbitCameraPosition(this.orbit);
      this.live_.camera.position.set(pos.x, pos.y, pos.z);
      this.live_.camera.lookAt(this.orbit.target.x, this.orbit.target.y, this.orbit.target.z);
    }
    this.updateDisturb(dt);
    this.liveAttractor?.compute();
  }
}
