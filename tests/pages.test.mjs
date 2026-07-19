import { describe, it, expect } from 'vitest';
import { renderPiecePage } from '../pipeline/pages.mjs';

const art = { day: 42, title: 'Spirality', slug: '042-spirality', palette: ['#112233','#223344','#334455','#445566','#556677'], brightness: 0.4, x: 1, y: 2 };

describe('renderPiecePage', () => {
  const html = renderPiecePage(art);
  it('includes title, day, og tags, image sources, app script', () => {
    expect(html).toContain('<title>Spirality — 042/365');
    expect(html).toContain('property="og:title" content="Spirality — 042/365 Strange Attractors"');
    expect(html).toContain('property="og:image" content="/images/1024/042-spirality.jpg"');
    expect(html).toContain('srcset="/images/1024/042-spirality.avif 1024w, /images/2000/042-spirality.avif 2000w"');
    expect(html).toContain('src="/images/1024/042-spirality.jpg"');
    expect(html).toContain('alt="Spirality — strange attractor, day 42 of 365, 2010"');
    expect(html).toContain('src="/assets/app.js"');
  });
  it('escapes html in titles', () => {
    expect(renderPiecePage({ ...art, title: 'A<B&C' })).toContain('A&lt;B&amp;C');
  });
});
