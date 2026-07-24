import { describe, it, expect } from 'vitest';
import { parseRoute, routePath } from '../src/router';
import { dayToDate, imageUrl } from '../src/data';

describe('parseRoute', () => {
  it('parses all route kinds', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/day/042-spirality/')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/day/042-spirality')).toEqual({ kind: 'day', slug: '042-spirality' });
    expect(parseRoute('/today/')).toEqual({ kind: 'today' });
    expect(parseRoute('/attractors/')).toEqual({ kind: 'attractors' });
    expect(parseRoute('/sound/')).toEqual({ kind: 'sound' });
    expect(parseRoute('/story/')).toEqual({ kind: 'story' });
    expect(parseRoute('/nonsense')).toEqual({ kind: 'home' });
  });
  it('maps legacy paths onto the new kinds', () => {
    expect(parseRoute('/index/')).toEqual({ kind: 'attractors' });
    expect(parseRoute('/music/')).toEqual({ kind: 'sound' });
    expect(parseRoute('/about/')).toEqual({ kind: 'story' });
  });
  it('round-trips through routePath onto canonical paths', () => {
    expect(routePath({ kind: 'day', slug: '001-rose' })).toBe('/day/001-rose/');
    expect(routePath({ kind: 'today' })).toBe('/today/');
    expect(parseRoute(routePath({ kind: 'attractors' }))).toEqual({ kind: 'attractors' });
    expect(parseRoute(routePath({ kind: 'sound' }))).toEqual({ kind: 'sound' });
    expect(parseRoute(routePath({ kind: 'story' }))).toEqual({ kind: 'story' });
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
