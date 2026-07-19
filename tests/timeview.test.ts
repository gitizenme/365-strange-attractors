import { describe, it, expect } from 'vitest';
import { spiralPosition } from '../src/timeview';

describe('spiralPosition', () => {
  it('starts at top with inner radius', () => {
    const p = spiralPosition(1);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(8, 5);
  });
  it('ends at outer radius after 3 turns (top again)', () => {
    const p = spiralPosition(365);
    expect(p.x).toBeCloseTo(0, -1);
    expect(p.y).toBeCloseTo(50, 0);
  });
  it('stays within world bounds', () => {
    for (let d = 1; d <= 365; d++) {
      const p = spiralPosition(d);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50.01);
    }
  });
  it('radius grows monotonically', () => {
    for (let d = 2; d <= 365; d++) {
      expect(Math.hypot(spiralPosition(d).x, spiralPosition(d).y))
        .toBeGreaterThan(Math.hypot(spiralPosition(d - 1).x, spiralPosition(d - 1).y));
    }
  });
});
