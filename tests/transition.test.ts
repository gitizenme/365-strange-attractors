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

  it('morphs same-family ifs days only when matrix counts match', () => {
    const p16 = Array.from({ length: 16 }, () => 0.1);
    expect(transitionKind(
      { day: 1, system: 'ifs', params: [...p16, ...p16] },
      { day: 2, system: 'ifs', params: [...p16, ...p16] },
    )).toBe('morph');
    expect(transitionKind(
      { day: 1, system: 'ifs', params: [...p16, ...p16] },
      { day: 2, system: 'ifs', params: [...p16, ...p16, ...p16] },
    )).toBe('dissolve');
  });

  it('morphs same-degree icon days, dissolves across degrees', () => {
    expect(transitionKind(
      { day: 1, system: 'icon', params: [3, 0.1, 0.2, 0.3, 0.4, 0.5] },
      { day: 2, system: 'icon', params: [3, 0.9, 0.8, 0.7, 0.6, 0.5] },
    )).toBe('morph');
    expect(transitionKind(
      { day: 1, system: 'icon', params: [3, 0.1, 0.2, 0.3, 0.4, 0.5] },
      { day: 2, system: 'icon', params: [5, 0.1, 0.2, 0.3, 0.4, 0.5] },
    )).toBe('dissolve');
  });

  it('existing behavior unchanged when params are absent', () => {
    expect(transitionKind({ day: 1, system: 'lorenz' }, { day: 2, system: 'lorenz' })).toBe('morph');
    expect(transitionKind({ day: 1, system: 'static-only' }, { day: 2, system: 'lorenz' })).toBe('dissolve');
  });
});
