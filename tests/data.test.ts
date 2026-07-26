import { describe, it, expect } from 'vitest';
import { dataUrl } from '../src/data';

describe('dataUrl', () => {
  // __BUILD_ID__ comes from vite `define`; vitest runs through the same vite
  // config, so a bare identifier here would mean the injection broke.
  it('appends the per-build cache-bust id', () => {
    expect(dataUrl('/data/attractors.json')).toMatch(/^\/data\/attractors\.json\?v=[\w-]+$/);
  });
  it('uses one id for every path in a build', () => {
    const v = (p: string) => dataUrl(p).split('?v=')[1];
    expect(v('/data/artworks.json')).toBe(v('/data/music.json'));
  });
});
