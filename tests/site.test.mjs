import { describe, it, expect } from 'vitest';
import { ORIGIN, SITE_TITLE, SITE_DESCRIPTION, AUTHOR, CARD_IMAGE, esc, metaTags } from '../pipeline/site.mjs';

describe('site constants', () => {
  it('are the agreed values', () => {
    expect(ORIGIN).toBe('https://chaosofzen.dev');
    expect(SITE_TITLE).toBe('365 Strange Attractors');
    expect(SITE_DESCRIPTION).toBe('One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file.');
    expect(AUTHOR).toBe('Joe Chavez');
    expect(CARD_IMAGE).toEqual({
      path: '/og/card.jpg', width: 1200, height: 630,
      alt: 'Photomosaic of all 365 strange attractors forming the numerals 365',
    });
  });
});

describe('metaTags', () => {
  const html = metaTags({
    title: 'Test Title', description: 'A description.',
    image: CARD_IMAGE, url: '/', type: 'website',
  });
  it('emits description, author, canonical', () => {
    expect(html).toContain('<meta name="description" content="A description." />');
    expect(html).toContain('<meta name="author" content="Joe Chavez" />');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/" />');
  });
  it('emits absolute og tags', () => {
    expect(html).toContain('<meta property="og:site_name" content="365 Strange Attractors" />');
    expect(html).toContain('<meta property="og:title" content="Test Title" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:url" content="https://chaosofzen.dev/" />');
    expect(html).toContain('<meta property="og:image" content="https://chaosofzen.dev/og/card.jpg" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain('<meta property="og:image:alt" content="Photomosaic of all 365 strange attractors forming the numerals 365" />');
  });
  it('emits twitter card tags', () => {
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="twitter:title" content="Test Title" />');
    expect(html).toContain('<meta name="twitter:image" content="https://chaosofzen.dev/og/card.jpg" />');
  });
  it('emits favicon links', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });
  it('omits og:image:width/height when image has no dimensions', () => {
    const h = metaTags({ title: 'T', description: 'D', image: { path: '/images/1024/x.jpg', alt: 'A' }, url: '/day/x/', type: 'article' });
    expect(h).not.toContain('og:image:width');
    expect(h).toContain('<meta property="og:image" content="https://chaosofzen.dev/images/1024/x.jpg" />');
    expect(h).toContain('<meta property="og:type" content="article" />');
  });
  it('escapes html in title and description', () => {
    const h = metaTags({ title: 'A<B&C"D', description: 'x', image: CARD_IMAGE, url: '/', type: 'website' });
    expect(h).toContain('content="A&lt;B&amp;C&quot;D"');
  });
});
