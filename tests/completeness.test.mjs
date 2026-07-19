import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const DATA = 'public/data/artworks.json';

describe.skipIf(!existsSync(DATA))('pipeline output completeness', () => {
  const art = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : [];
  it('has 365 artworks, days 1..365, unique slugs', () => {
    expect(art.length).toBe(365);
    expect(new Set(art.map(a => a.slug)).size).toBe(365);
    art.forEach((a, i) => expect(a.day).toBe(i + 1));
  });
  it('every artwork has coordinates, palette, images', () => {
    for (const a of art) {
      expect(Math.abs(a.x)).toBeLessThanOrEqual(50);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(50);
      expect(a.palette).toHaveLength(5);
      for (const size of ['2000', '1024', '256'])
        expect(existsSync(`public/images/${size}/${a.slug}.jpg`), `${size}/${a.slug}`).toBe(true);
    }
  });
  it('atlas covers every slug', () => {
    const atlas = JSON.parse(readFileSync('public/data/atlas.json', 'utf8'));
    for (const a of art) expect(atlas.index[a.slug]).toBeGreaterThanOrEqual(0);
  });
});
