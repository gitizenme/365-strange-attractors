import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildOgCard } from '../pipeline/social.mjs';

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
