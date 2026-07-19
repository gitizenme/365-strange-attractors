import { describe, it, expect } from 'vitest';
import { nearestSprite } from '../src/picking';

const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }];
const posOf = (i: number) => pts[i];

describe('nearestSprite', () => {
  it('returns index of nearest point within maxDist', () => {
    expect(nearestSprite({ x: 1, y: 0 }, posOf, 3, 5)).toBe(0);
    expect(nearestSprite({ x: 9, y: 1 }, posOf, 3, 5)).toBe(1);
  });
  it('returns null when nothing is close enough', () => {
    expect(nearestSprite({ x: 100, y: 100 }, posOf, 3, 5)).toBeNull();
  });
});
