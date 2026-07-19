import { describe, it, expect } from 'vitest';
import { initialOrbitState, applyOrbitDrag, applyOrbitZoom, orbitCameraPosition } from '../src/attractor/orbit';

describe('initialOrbitState', () => {
  it('centers on the given target with a positive default radius', () => {
    const s = initialOrbitState({ x: 1, y: 2, z: 3 });
    expect(s.target).toEqual({ x: 1, y: 2, z: 3 });
    expect(s.radius).toBeGreaterThan(0);
    expect(s.azimuth).toBe(0);
    expect(s.elevation).toBe(0);
  });
});

describe('applyOrbitDrag', () => {
  it('changes azimuth from horizontal drag, elevation from vertical drag', () => {
    const s = initialOrbitState({ x: 0, y: 0, z: 0 });
    const horiz = applyOrbitDrag(s, 100, 0);
    expect(horiz.azimuth).not.toBe(0);
    expect(horiz.elevation).toBe(0);
    const vert = applyOrbitDrag(s, 0, 100);
    expect(vert.elevation).not.toBe(0);
  });
  it('clamps elevation so the camera cannot flip over the poles', () => {
    const s = initialOrbitState({ x: 0, y: 0, z: 0 });
    const extreme = applyOrbitDrag(s, 0, 1_000_000);
    expect(extreme.elevation).toBeGreaterThanOrEqual(-1.4);
    expect(extreme.elevation).toBeLessThanOrEqual(1.4);
  });
});

describe('applyOrbitZoom', () => {
  it('shrinks radius on zoom-in, clamped to a minimum', () => {
    const s = initialOrbitState({ x: 0, y: 0, z: 0 });
    expect(applyOrbitZoom(s, -1000).radius).toBeLessThan(s.radius);
    expect(applyOrbitZoom(s, -1_000_000).radius).toBeGreaterThanOrEqual(3);
  });
  it('grows radius on zoom-out, clamped to a maximum', () => {
    const s = initialOrbitState({ x: 0, y: 0, z: 0 });
    expect(applyOrbitZoom(s, 1000).radius).toBeGreaterThan(s.radius);
    expect(applyOrbitZoom(s, 1_000_000).radius).toBeLessThanOrEqual(30);
  });
});

describe('orbitCameraPosition', () => {
  it('sits directly in front of the target along +z when azimuth/elevation are 0', () => {
    const p = orbitCameraPosition({ azimuth: 0, elevation: 0, radius: 10, target: { x: 0, y: 0, z: 0 } });
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.z).toBeCloseTo(10, 5);
  });
});
