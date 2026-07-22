import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildOgCard, buildFavicons } from '../pipeline/social.mjs';

const dir = mkdtempSync(join(tmpdir(), 'social-'));
const src = join(dir, 'mosaic.png');

beforeAll(async () => {
  // synthetic stand-in for the real mosaic (any large-ish image)
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 10, b: 60 } } })
    .png().toFile(src);
});

describe('buildOgCard', () => {
  it('writes a 1200x630 jpeg', async () => {
    const out = join(dir, 'og', 'card.jpg');
    await buildOgCard(src, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe('jpeg');
  });
  it('throws when the source is missing', async () => {
    await expect(buildOgCard(join(dir, 'nope.png'), join(dir, 'x.jpg')))
      .rejects.toThrow(/og card source missing/);
  });
});

describe('buildFavicons', () => {
  it('writes favicon.ico, icon.svg, apple-touch-icon.png', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fav-'));
    await buildFavicons(src, out);

    const ico = readFileSync(join(out, 'favicon.ico'));
    expect([ico[0], ico[1], ico[2], ico[3]]).toEqual([0, 0, 1, 0]); // ICO header

    const svg = readFileSync(join(out, 'icon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('data:image/png;base64,');

    const apple = await sharp(join(out, 'apple-touch-icon.png')).metadata();
    expect(apple.width).toBe(180);
    expect(apple.height).toBe(180);
    expect(apple.format).toBe('png');
  });
  it('throws when the source is missing', async () => {
    await expect(buildFavicons(join(dir, 'nope.jpg'), dir))
      .rejects.toThrow(/favicon source missing/);
  });
});
