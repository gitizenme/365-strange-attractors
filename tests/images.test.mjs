import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { makeDerivatives, buildAtlas } from '../pipeline/images.mjs';

let dir, src;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'la-img-'));
  src = join(dir, 'src.jpg');
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .jpeg().toFile(src);
});

describe('makeDerivatives', () => {
  it('writes avif/webp/jpg at three widths (never upscaling)', async () => {
    await makeDerivatives(src, '001-rose', dir);
    for (const size of [2000, 1024, 256])
      for (const ext of ['avif', 'webp', 'jpg'])
        expect(existsSync(join(dir, 'images', String(size), `001-rose.${ext}`))).toBe(true);
    const meta = await sharp(join(dir, 'images', '2000', '001-rose.jpg')).metadata();
    expect(meta.width).toBe(400); // source smaller than 2000 → not upscaled
    const meta256 = await sharp(join(dir, 'images', '256', '001-rose.jpg')).metadata();
    expect(meta256.width).toBe(256);
  });
});

describe('buildAtlas', () => {
  it('composites square tiles and writes manifest', async () => {
    const items = [{ slug: '001-rose', srcPath: src }, { slug: '002-x', srcPath: src }];
    const manifest = await buildAtlas(items, dir);
    expect(manifest).toEqual({ tile: 128, cols: 20, rows: 1, index: { '001-rose': 0, '002-x': 1 } });
    const meta = await sharp(join(dir, 'images', 'atlas.png')).metadata();
    expect(meta.width).toBe(20 * 128);
    expect(meta.height).toBe(128);
    expect(JSON.parse(readFileSync(join(dir, 'data', 'atlas.json'), 'utf8'))).toEqual(manifest);
  });
});
