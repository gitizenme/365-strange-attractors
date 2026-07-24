import { describe, it, expect } from 'vitest';
import { renderRoutePage, ROUTE_PAGES } from '../pipeline/routepages.mjs';

describe('ROUTE_PAGES', () => {
  it('covers the three veil destinations plus the /today/ shell', () => {
    expect(ROUTE_PAGES.map(r => r.path)).toEqual(['/attractors/', '/sound/', '/story/', '/today/']);
  });
});

describe('renderRoutePage', () => {
  const html = renderRoutePage(ROUTE_PAGES[0]);
  it('is a full app shell with canonical meta', () => {
    expect(html).toContain('<canvas id="gl">');
    expect(html).toContain('<link rel="canonical" href="https://chaosofzen.dev/attractors/" />');
    expect(html).toContain('/assets/app.js');
    expect(html).toContain('/assets/index.css');
  });
  it('carries the crawler nav', () => {
    for (const p of ['/today/', '/attractors/', '/sound/', '/story/']) {
      expect(html).toContain(`href="${p}"`);
    }
  });
});

describe('renderRoutePage noindex', () => {
  it('marks the /today/ shell noindex', () => {
    const todayPage = ROUTE_PAGES.find(r => r.path === '/today/');
    const html = renderRoutePage(todayPage);
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
  it('does not mark the attractors page noindex', () => {
    const attractorsPage = ROUTE_PAGES.find(r => r.path === '/attractors/');
    const html = renderRoutePage(attractorsPage);
    expect(html).not.toContain('<meta name="robots" content="noindex" />');
  });
});
