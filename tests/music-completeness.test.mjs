import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const DATA = 'public/data/music.json';
const URL_RE = /^https:\/\//;

describe.skipIf(!existsSync(DATA))('music.json completeness', () => {
  const music = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : null;

  it('has an artist with all required fields and well-formed URLs', () => {
    const { artist } = music;
    expect(artist.name).toBe('Chaos of Zen');
    expect(typeof artist.bio).toBe('string');
    expect(artist.bio.length).toBeGreaterThan(0);
    for (const key of ['appleMusicUrl', 'youtubeUrl', 'spotifyUrl']) {
      expect(artist[key], key).toMatch(URL_RE);
    }
  });

  it('has exactly 2 albums, each with required fields and well-formed URLs', () => {
    expect(music.albums).toHaveLength(2);
    for (const a of music.albums) {
      expect(typeof a.title).toBe('string');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.year).toBeGreaterThan(2000);
      expect(a.trackCount).toBeGreaterThan(0);
      expect(a.artworkUrl).toMatch(URL_RE);
      expect(a.appleMusicUrl).toMatch(URL_RE);
    }
  });

  it('has exactly 6 music videos, all number-matched to a YouTube URL', () => {
    expect(music.musicVideos).toHaveLength(6);
    for (const r of music.musicVideos) {
      expect(r.type).toBe('video');
      expect(r.artworkUrl).toMatch(URL_RE);
      expect(r.appleMusicUrl).toMatch(URL_RE);
      expect(r.youtubeUrl, `${r.title} should have a matched YouTube URL`).toMatch(URL_RE);
    }
  });

  it('has more than the 7-item preview count of singles/EPs, each well-formed', () => {
    expect(music.singles.length).toBeGreaterThan(7);
    for (const r of music.singles) {
      expect(['single', 'ep']).toContain(r.type);
      expect(r.year).toBeGreaterThan(2000);
      expect(r.artworkUrl).toMatch(URL_RE);
      expect(r.appleMusicUrl).toMatch(URL_RE);
      if (r.youtubeUrl !== undefined) expect(r.youtubeUrl).toMatch(URL_RE);
    }
  });

  it('has no duplicate titles within musicVideos or within singles', () => {
    expect(new Set(music.musicVideos.map(r => r.title)).size).toBe(music.musicVideos.length);
    expect(new Set(music.singles.map(r => r.title)).size).toBe(music.singles.length);
  });

  it('does not include the unrelated "En la Cigarra" track', () => {
    const all = [...music.musicVideos, ...music.singles];
    expect(all.some(r => r.title.includes('Protagonista'))).toBe(false);
  });
});
