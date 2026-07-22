import { describe, it, expect } from 'vitest';
import { renderPiecePage } from '../pipeline/pages.mjs';

const art = { day: 42, title: 'Spirality', slug: '042-spirality', palette: ['#112233','#223344','#334455','#445566','#556677'], brightness: 0.4, x: 1, y: 2 };

describe('renderPiecePage', () => {
  const html = renderPiecePage(art);
  it('includes title, day, image sources, app script', () => {
    expect(html).toContain('<title>Spirality — 042/365 Strange Attractors</title>');
    expect(html).toContain('srcset="/images/1024/042-spirality.avif 1024w, /images/2000/042-spirality.avif 2000w"');
    expect(html).toContain('src="/images/1024/042-spirality.jpg"');
    expect(html).toContain('alt="Spirality — strange attractor, day 42 of 365, 2010"');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).toContain('href="/assets/index.css"'); // must match vite's actual build output name
  });
  it('has absolute og/twitter/canonical metadata', () => {
    expect(html).toContain('<meta property="og:title" content="Spirality — 042/365 Strange Attractors" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta property="og:url" content="https://chaosofzen.dev/day/042-spirality/" />');
    expect(html).toContain('<meta property="og:image" content="https://chaosofzen.dev/images/1024/042-spirality.jpg" />');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/day/042-spirality/" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="description" content="Spirality, a strange attractor created on day 42 of 365 in 2010." />');
    expect(html).toContain('<meta name="author" content="Joe Chavez" />');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
  });
  it('escapes html in titles', () => {
    expect(renderPiecePage({ ...art, title: 'A<B&C' })).toContain('A&lt;B&amp;C');
  });
});
