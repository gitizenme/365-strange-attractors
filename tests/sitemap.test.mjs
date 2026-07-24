import { describe, it, expect } from 'vitest';
import { renderSitemap } from '../pipeline/sitemap.mjs';

describe('renderSitemap', () => {
  const xml = renderSitemap([{ slug: '001-rose' }, { slug: '002-event-horizon' }]);
  it('lists root, the three veil routes, and every day, absolute', () => {
    expect(xml).toContain('<loc>https://chaosofzen.dev/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/attractors/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/sound/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/story/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/001-rose/</loc>');
    expect(xml).toContain('<loc>https://chaosofzen.dev/day/002-event-horizon/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(6);
  });
  it('is a urlset document with xml declaration', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
