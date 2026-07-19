import { describe, it, expect } from 'vitest';
import { pickTier } from '../src/attractor/tiers';

describe('pickTier', () => {
  it('returns null when WebGL2 is unavailable', () => {
    expect(pickTier({ webgl2: false, isMobile: false })).toBeNull();
  });
  it('returns 256 on mobile', () => {
    expect(pickTier({ webgl2: true, isMobile: true })).toBe(256);
  });
  it('returns 2048 on desktop with high memory', () => {
    expect(pickTier({ webgl2: true, isMobile: false, deviceMemoryGB: 8 })).toBe(2048);
  });
  it('returns 1024 on desktop with unknown/low memory', () => {
    expect(pickTier({ webgl2: true, isMobile: false })).toBe(1024);
    expect(pickTier({ webgl2: true, isMobile: false, deviceMemoryGB: 4 })).toBe(1024);
  });
});
