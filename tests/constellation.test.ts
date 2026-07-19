import { describe, it, expect } from 'vitest';
import { atlasUv } from '../src/constellation';

const atlas = { tile: 128, cols: 20, rows: 19, index: { '001-rose': 0, '002-x': 21 } };

describe('atlasUv', () => {
  it('computes tile origin and span in flipY texture coords', () => {
    // tile 0: col 0, row 0 (top-left of image = v near 1 with flipY)
    expect(atlasUv(atlas, '001-rose')).toEqual({ u: 0, v: 1 - 1 / 19, su: 1 / 20, sv: 1 / 19 });
    // tile 21: col 1, row 1
    expect(atlasUv(atlas, '002-x')).toEqual({ u: 1 / 20, v: 1 - 2 / 19, su: 1 / 20, sv: 1 / 19 });
  });
});
