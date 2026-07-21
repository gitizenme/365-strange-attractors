import { describe, it, expect } from 'vitest';
import { parseRoute, routePath } from '../src/router';
import { dayToDate, imageUrl } from '../src/data';

describe('parseRoute', () => {
  it('parses all route kinds', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/day/042-spirality/')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/day/042-spirality')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/index/')).toEqual({ kind: 'index' });
    expect(parseRoute('/about/')).toEqual({ kind: 'about' });
    expect(parseRoute('/music/')).toEqual({ kind: 'music' });
    expect(parseRoute('/nonsense')).toEqual({ kind: 'home' });
  });
  it('round-trips through routePath', () => {
    expect(routePath({ kind: 'day', slug: '001-rose' })).toBe('/day/001-rose/');
    expect(parseRoute(routePath({ kind: 'index' }))).toEqual({ kind: 'index' });
    expect(parseRoute(routePath({ kind: 'music' }))).toEqual({ kind: 'music' });
  });
});

describe('dayToDate', () => {
  it('maps day-of-year to 2010 calendar dates', () => {
    expect(dayToDate(1)).toEqual({ month: 1, date: 1 });
    expect(dayToDate(31)).toEqual({ month: 1, date: 31 });
    expect(dayToDate(32)).toEqual({ month: 2, date: 1 });
    expect(dayToDate(59)).toEqual({ month: 2, date: 28 });
    expect(dayToDate(60)).toEqual({ month: 3, date: 1 });
    expect(dayToDate(365)).toEqual({ month: 12, date: 31 });
  });
});

describe('imageUrl', () => {
  it('builds derivative paths', () => {
    expect(imageUrl('001-rose', 1024, 'webp')).toBe('/images/1024/001-rose.webp');
  });
});
