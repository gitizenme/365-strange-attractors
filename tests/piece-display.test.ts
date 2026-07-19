import { describe, it, expect } from 'vitest';
import { estimateChaoticFlowDisplay, estimateLorenz84Display } from '../src/piece';

// day 002-event-horizon's real params (lorenz_84: a, b, F, G, dt)
const LORENZ84_PARAMS = [4.41558441558442, 1.401, 1.798, 1.997, 0.299];
// day 001-rose's real params (chaotic_flow, fast-mixing — already worked before this fix)
const CHAOTIC_FLOW_FAST = [-0.368, 0, -0.695, 2, 0.305, 0, 0.924, 0.088, 2, -0.569, 0, -0.288, 3, 0.205, -0.234, 1, -0.717, 0, 0.812, 2, 0.928, 0.883];
// day 025-sometimes-chaos's real params (chaotic_flow, slow-mixing — the reported bug day)
const CHAOTIC_FLOW_SLOW = [-0.408, 0, -0.178, 3, -0.252, 3, 0.519, 0.675, 1, 0.828, 3, 0.879, 2, 0.341, 0.296, 2, -0.685, 3, -0.895, 2, -0.022, 0.023];

function spread(points: Float32Array): { xRange: number; yRange: number; zRange: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    minZ = Math.min(minZ, points[i + 2]); maxZ = Math.max(maxZ, points[i + 2]);
  }
  return { xRange: maxX - minX, yRange: maxY - minY, zRange: maxZ - minZ };
}

describe('estimateLorenz84Display', () => {
  it('returns a finite positive scale and a seed point pool for a real day', () => {
    const result = estimateLorenz84Display(LORENZ84_PARAMS);
    expect(result.scale).toBeGreaterThan(0);
    expect(isFinite(result.scale)).toBe(true);
    expect(isFinite(result.centerZ)).toBe(true);
    expect(result.seed.points.length).toBeGreaterThan(0);
    expect(result.seed.points.length % 3).toBe(0);
    expect(result.seed.jitter).toBeGreaterThan(0);
    for (const v of result.seed.points) expect(isFinite(v)).toBe(true);
  });
});

describe('estimateChaoticFlowDisplay', () => {
  it('returns a finite positive scale and a seed point pool for a fast-mixing day', () => {
    const result = estimateChaoticFlowDisplay(CHAOTIC_FLOW_FAST);
    expect(result.scale).toBeGreaterThan(0);
    expect(isFinite(result.scale)).toBe(true);
    expect(result.seed.points.length).toBeGreaterThan(0);
    for (const v of result.seed.points) expect(isFinite(v)).toBe(true);
  });

  it('samples a spread of real points along the trajectory for the slow-mixing reference day (025), not a collapsed cluster', () => {
    // This is the regression test for the bug this task fixes: LiveAttractor used to seed all
    // ~1M points from a tiny [-0.05, 0.05]^3 cube, so day 025's cloud only "filled in" over a
    // very long mixing timescale. The fix seeds from real points sampled along one long CPU
    // trajectory instead — those points should already span the attractor's true extent (per
    // task-11-report.md's independent CPU re-simulation, roughly X~15/Y~80/Z~45 half-extents),
    // not sit clustered within a fraction of a unit like the old default seeding did.
    const result = estimateChaoticFlowDisplay(CHAOTIC_FLOW_SLOW);
    expect(result.seed.points.length).toBeGreaterThan(300 * 3); // plenty of distinct samples
    const { xRange, yRange, zRange } = spread(result.seed.points);
    // The old bug-triggering seed cube was only 0.1 units wide per axis; require the sampled
    // pool to span at least two orders of magnitude more than that on every axis.
    expect(xRange).toBeGreaterThan(1);
    expect(yRange).toBeGreaterThan(1);
    expect(zRange).toBeGreaterThan(1);
  });

  it('produces a jitter that scales with the day\'s own extent rather than a flat constant', () => {
    const fast = estimateChaoticFlowDisplay(CHAOTIC_FLOW_FAST);
    const slow = estimateChaoticFlowDisplay(CHAOTIC_FLOW_SLOW);
    expect(fast.seed.jitter).toBeGreaterThan(0);
    expect(slow.seed.jitter).toBeGreaterThan(0);
    // day 025's natural extent is much larger than day 001's, so its jitter should be too.
    expect(slow.seed.jitter).toBeGreaterThan(fast.seed.jitter);
  });
});
