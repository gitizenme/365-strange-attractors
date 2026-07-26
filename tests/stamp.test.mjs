import { describe, it, expect } from 'vitest';
import { findBundle, stampHtml } from '../pipeline/stamp.mjs';
import { renderPiecePage } from '../pipeline/pages.mjs';
import { renderRoutePage, render404Page, ROUTE_PAGES } from '../pipeline/routepages.mjs';

const bundle = { js: 'app-B1a2C3d4.js', css: 'index-Ee5Ff6Gg.css' };

describe('findBundle', () => {
  it('picks the hashed bundle pair out of an assets listing', () => {
    expect(findBundle(['app-B1a2C3d4.js', 'index-Ee5Ff6Gg.css'])).toEqual(bundle);
  });
  it('ignores unrelated assets', () => {
    expect(findBundle(['app-x_9-Z.js', 'index-q1.css', 'font-abc.woff2'])).toEqual({
      js: 'app-x_9-Z.js',
      css: 'index-q1.css',
    });
  });
  it('throws when a bundle is missing', () => {
    expect(() => findBundle(['index-Ee5Ff6Gg.css'])).toThrow(/expected exactly one/);
    expect(() => findBundle(['app-B1a2C3d4.js'])).toThrow(/expected exactly one/);
  });
  it('throws on ambiguity — a stale second bundle must fail the build, not ship', () => {
    expect(() => findBundle(['app-old1.js', 'app-new2.js', 'index-q1.css'])).toThrow(/expected exactly one/);
  });
  it('does not accept the unhashed placeholder names as a bundle', () => {
    expect(() => findBundle(['app.js', 'index.css'])).toThrow(/expected exactly one/);
  });
});

describe('stampHtml', () => {
  it('rewrites placeholder references to the hashed names', () => {
    const html = '<link rel="stylesheet" href="/assets/index.css" />\n<script type="module" src="/assets/app.js"></script>';
    const out = stampHtml(html, bundle);
    expect(out).toContain('href="/assets/index-Ee5Ff6Gg.css"');
    expect(out).toContain('src="/assets/app-B1a2C3d4.js"');
    expect(out).not.toContain('/assets/app.js');
    expect(out).not.toContain('/assets/index.css');
  });
  it('rewrites names stamped by a previous build — the CI deploy-repo restamp case', () => {
    const previous = '<link rel="stylesheet" href="/assets/index-OLDHASH1.css" />\n<script type="module" src="/assets/app-OLDHASH1.js"></script>';
    const out = stampHtml(previous, bundle);
    expect(out).toContain('/assets/app-B1a2C3d4.js');
    expect(out).toContain('/assets/index-Ee5Ff6Gg.css');
    expect(out).not.toContain('OLDHASH1');
  });
  it('is idempotent', () => {
    const once = stampHtml('<script src="/assets/app.js"></script>', bundle);
    expect(stampHtml(once, bundle)).toBe(once);
  });
  it('leaves image, data, and other stable URLs alone', () => {
    const html = '<img src="/images/1024/001-rose.jpg" /><a href="/data/attractors.json">d</a><link href="/favicon.ico" />';
    expect(stampHtml(html, bundle)).toBe(html);
  });
  it('rewrites every shell the pipeline emits — templates and stamp regexes must not drift', () => {
    const shells = [
      renderPiecePage({ day: 1, title: 'Rose', slug: '001-rose' }),
      render404Page(),
      ...ROUTE_PAGES.map(rp => renderRoutePage(rp)),
    ];
    for (const html of shells) {
      const out = stampHtml(html, bundle);
      expect(out).toContain(`/assets/${bundle.js}`);
      expect(out).toContain(`/assets/${bundle.css}`);
      expect(out).not.toMatch(/\/assets\/app\.js|\/assets\/index\.css/);
    }
  });
});
