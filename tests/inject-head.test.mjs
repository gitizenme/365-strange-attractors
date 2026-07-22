import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { injectHead } from '../pipeline/inject-head.mjs';

describe('injectHead', () => {
  it('replaces the placeholder with site metadata', () => {
    const out = injectHead('<head><!-- site-head --></head>');
    expect(out).not.toContain('site-head');
    expect(out).toContain('<meta name="description" content="One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file." />');
    expect(out).toContain('<meta property="og:type" content="website" />');
    expect(out).toContain('<meta property="og:image" content="https://chaosofzen.dev/og/card.jpg" />');
    expect(out).toContain('<link rel="canonical" href="https://chaosofzen.dev/" />');
    expect(out).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
  });
  it('the real index.html contains the placeholder', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<!-- site-head -->');
  });
});
