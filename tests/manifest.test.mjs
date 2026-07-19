import { describe, it, expect } from 'vitest';
import { slugify, parseTitlesCsv, scanGenerated, buildDays } from '../pipeline/manifest.mjs';

describe('slugify', () => {
  it('kebab-cases and strips punctuation', () => {
    expect(slugify("Satellite of Love")).toBe('satellite-of-love');
    expect(slugify("A Certain Uncertainty")).toBe('a-certain-uncertainty');
  });
});

describe('parseTitlesCsv', () => {
  it('extracts day and title, ignores junk lines and dupes', () => {
    const csv = '001/365 Rose,http://x/001.png,bundle://a,bundle://b\r\n' +
      '002/365 Event Horizon,http://x/002.png,b,c\n' +
      'garbage line\n' +
      '002/365 Duplicate,http://x,b,c\n';
    const m = parseTitlesCsv(csv);
    expect(m.get(1)).toBe('Rose');
    expect(m.get(2)).toBe('Event Horizon');
    expect(m.size).toBe(2);
  });
});

describe('scanGenerated', () => {
  it('maps day number to filename, keeps first match, ignores non-day files', () => {
    const m = scanGenerated(['001_Rose.jpg', '002_Event_Horizon.jpg', 'notes.txt', '002_Alt.jpg']);
    expect(m.get(1)).toBe('001_Rose.jpg');
    expect(m.get(2)).toBe('002_Event_Horizon.jpg');
    expect(m.size).toBe(2);
  });
});

describe('buildDays', () => {
  it('merges titles with images, falls back to filename title', () => {
    const csv = '001/365 Rose,u,b,c\n';
    const files = ['001_Rose.jpg', '002_Event_Horizon.jpg'];
    const days = buildDays(csv, files, 2);
    expect(days).toEqual([
      { day: 1, title: 'Rose', slug: '001-rose', sourceImage: '001_Rose.jpg' },
      { day: 2, title: 'Event Horizon', slug: '002-event-horizon', sourceImage: '002_Event_Horizon.jpg' },
    ]);
  });
  it('throws when a day has no image', () => {
    expect(() => buildDays('', ['001_Rose.jpg'], 2)).toThrow(/missing source image for day 2/i);
  });
});
