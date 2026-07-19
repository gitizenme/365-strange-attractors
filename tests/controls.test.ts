import { describe, it, expect } from 'vitest';
import { stepInertia, clampCamera, zoomToward } from '../src/controls';

describe('stepInertia', () => {
  it('decays velocity exponentially and snaps to zero', () => {
    const v1 = stepInertia({ x: 10, y: 0 }, 1 / 60);
    expect(v1.x).toBeLessThan(10);
    expect(v1.x).toBeGreaterThan(0);
    let v = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 600; i++) v = stepInertia(v, 1 / 60);
    expect(v).toEqual({ x: 0, y: 0 });
  });
});

describe('clampCamera', () => {
  it('clamps xy to bounds and z to range', () => {
    expect(clampCamera({ x: 100, y: -100, z: 1 }, 60, 4, 140)).toEqual({ x: 60, y: -60, z: 4 });
    expect(clampCamera({ x: 0, y: 0, z: 200 }, 60, 4, 140)).toEqual({ x: 0, y: 0, z: 140 });
  });
});

describe('zoomToward', () => {
  it('moves camera xy toward target when zooming in', () => {
    const cam = { x: 0, y: 0, z: 100 };
    const out = zoomToward(cam, { x: 10, y: 0 }, 0.5); // halve distance
    expect(out.z).toBe(50);
    expect(out.x).toBeCloseTo(5); // xy interpolates by same factor
  });
  it('is identity at factor 1', () => {
    expect(zoomToward({ x: 3, y: 4, z: 80 }, { x: 0, y: 0 }, 1)).toEqual({ x: 3, y: 4, z: 80 });
  });
});
