import { describe, it, expect } from 'vitest';
import { transitionKind } from '../src/piece';

describe('transitionKind', () => {
  it('morphs when both days share the same in-scope family', () => {
    expect(transitionKind({ day: 2, system: 'lorenz_84' }, { day: 3, system: 'lorenz_84' })).toBe('morph');
  });
  it('dissolves across different families', () => {
    expect(transitionKind({ day: 1, system: 'chaotic_flow' }, { day: 2, system: 'lorenz_84' })).toBe('dissolve');
  });
  it('dissolves when either side is static-only', () => {
    expect(transitionKind({ day: 4, system: 'lorenz' }, { day: 5, system: 'static-only' })).toBe('dissolve');
    expect(transitionKind({ day: 4, system: 'static-only' }, { day: 5, system: 'static-only' })).toBe('dissolve');
  });
  it('dissolves when either side is null (unknown attractor data)', () => {
    expect(transitionKind(null, { day: 1, system: 'lorenz' })).toBe('dissolve');
  });
});
