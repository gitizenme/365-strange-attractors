import { describe, it, expect } from 'vitest';
import { platformLinks } from '../src/musicdata';
import type { Release } from '../src/musicdata';

const release = (overrides: Partial<Release> = {}): Release => ({
  title: '52.14', type: 'single', year: 2026,
  artworkUrl: 'https://example.com/art.jpg',
  appleMusicUrl: 'https://music.apple.com/us/song/example/1',
  ...overrides,
});

describe('platformLinks', () => {
  it('always includes Apple Music', () => {
    const links = platformLinks(release());
    expect(links).toContainEqual({ label: 'Apple Music', url: 'https://music.apple.com/us/song/example/1' });
  });
  it('omits YouTube when the release has no youtubeUrl', () => {
    const links = platformLinks(release());
    expect(links).toHaveLength(1);
    expect(links.some(l => l.label === 'YouTube')).toBe(false);
  });
  it('includes YouTube when the release has a matched youtubeUrl', () => {
    const links = platformLinks(release({ youtubeUrl: 'https://youtube.com/watch?v=abc123' }));
    expect(links).toContainEqual({ label: 'YouTube', url: 'https://youtube.com/watch?v=abc123' });
    expect(links).toHaveLength(2);
  });
});
