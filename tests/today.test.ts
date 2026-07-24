import { describe, it, expect } from 'vitest';
import { dateToDay2010, resolveToday, settleCamera, todayCaption } from '../src/today';
import type { Artwork } from '../src/data';

const art = (day: number): Artwork =>
  ({ day, title: `t${day}`, slug: `${String(day).padStart(3, '0')}-x`, palette: [], brightness: 0, x: 0, y: 0 });
const artworks = Array.from({ length: 365 }, (_, i) => art(i + 1));

describe('dateToDay2010', () => {
  it('maps month/day onto 2010 day-of-year', () => {
    expect(dateToDay2010(1, 1)).toBe(1);
    expect(dateToDay2010(1, 31)).toBe(31);
    expect(dateToDay2010(2, 28)).toBe(59);
    expect(dateToDay2010(3, 1)).toBe(60);
    expect(dateToDay2010(7, 23)).toBe(204);
    expect(dateToDay2010(12, 31)).toBe(365);
  });
  it('maps leap-day Feb 29 onto Feb 28 (2010 had no Feb 29)', () => {
    expect(dateToDay2010(2, 29)).toBe(59);
  });
});

describe('resolveToday', () => {
  it('uses the local month/day', () => {
    expect(resolveToday(new Date(2026, 6, 23), artworks).day).toBe(204);
    expect(resolveToday(new Date(2028, 1, 29), artworks).day).toBe(59); // leap year
  });
});

describe('settleCamera', () => {
  it('centers on the target and picks z so the sprite fills the height fraction', () => {
    const s = settleCamera({ x: 3, y: -2 }, 50);
    expect(s.x).toBe(3);
    expect(s.y).toBe(-2);
    // sprite is 1.6 world units; 15% of viewport => visible height 1.6/0.15; z = h / (2 tan(fov/2))
    const expectedZ = (1.6 / 0.15) / (2 * Math.tan((50 * Math.PI) / 360));
    expect(s.z).toBeCloseTo(expectedZ, 5);
  });
});

describe('todayCaption', () => {
  it('renders the day label and title', () => {
    expect(todayCaption({ day: 204, title: 'Gumballs' }))
      .toEqual({ label: 'Day 204 · July 23', title: 'Gumballs' });
  });
});
