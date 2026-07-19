import { describe, it, expect } from 'vitest';
import { searchArtworks } from '../src/indexview';

const art = (day: number, title: string) =>
  ({ day, title, slug: `${String(day).padStart(3, '0')}-x`, palette: [], brightness: 0, x: 0, y: 0 });
const all = [art(1, 'Rose'), art(42, 'Spirality'), art(97, 'Satellite of Love'), art(300, 'Rose Garden')];

describe('searchArtworks', () => {
  it('matches day numbers exactly', () => {
    expect(searchArtworks(all, '42')[0].day).toBe(42);
    expect(searchArtworks(all, '042')[0].day).toBe(42);
  });
  it('matches title substrings case-insensitively, in day order', () => {
    expect(searchArtworks(all, 'rose').map(a => a.day)).toEqual([1, 300]);
    expect(searchArtworks(all, 'LOVE')[0].day).toBe(97);
  });
  it('returns empty for no match or blank query', () => {
    expect(searchArtworks(all, 'zzz')).toEqual([]);
    expect(searchArtworks(all, '  ')).toEqual([]);
  });
});
