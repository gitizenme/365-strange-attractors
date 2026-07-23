import { describe, it, expect } from 'vitest';
import { atlasUv, computeCloudBounds } from '../src/constellation';
import { spiralPosition } from '../src/timeview';

const atlas = { tile: 128, cols: 20, rows: 19, index: { '001-rose': 0, '002-x': 21 }, files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' } };

describe('atlasUv', () => {
  it('computes tile origin and span in flipY texture coords', () => {
    // tile 0: col 0, row 0 (top-left of image = v near 1 with flipY)
    expect(atlasUv(atlas, '001-rose')).toEqual({ u: 0, v: 1 - 1 / 19, su: 1 / 20, sv: 1 / 19 });
    // tile 21: col 1, row 1
    expect(atlasUv(atlas, '002-x')).toEqual({ u: 1 / 20, v: 1 - 2 / 19, su: 1 / 20, sv: 1 / 19 });
  });
});

describe('computeCloudBounds', () => {
  it('unions UMAP and spiral positions, then pads by ~10%', () => {
    const artworks = [
      { day: 1, x: 20, y: 0 },
      { day: 90, x: -5, y: -3 },
    ];
    const s1 = spiralPosition(1), s2 = spiralPosition(90);
    const rawMinX = Math.min(20, -5, s1.x, s2.x);
    const rawMaxX = Math.max(20, -5, s1.x, s2.x);
    const rawMinY = Math.min(0, -3, s1.y, s2.y);
    const rawMaxY = Math.max(0, -3, s1.y, s2.y);
    const padX = (rawMaxX - rawMinX) * 0.1;
    const padY = (rawMaxY - rawMinY) * 0.1;

    const bounds = computeCloudBounds(artworks);
    expect(bounds.minX).toBeCloseTo(rawMinX - padX, 5);
    expect(bounds.maxX).toBeCloseTo(rawMaxX + padX, 5);
    expect(bounds.minY).toBeCloseTo(rawMinY - padY, 5);
    expect(bounds.maxY).toBeCloseTo(rawMaxY + padY, 5);
  });

  it('includes the spiral point even when the UMAP point sits near the origin (Time mode stays in frame)', () => {
    const artworks = [{ day: 365, x: 0, y: 0 }]; // spiralPosition(365) is near (0, 50) -- see tests/timeview.test.ts
    const bounds = computeCloudBounds(artworks);
    expect(bounds.maxY).toBeGreaterThan(40);
  });
});
