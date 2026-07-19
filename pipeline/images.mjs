import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [2000, 1024, 256];
const TILE = 128;
const COLS = 20;

export async function makeDerivatives(srcPath, slug, outRoot) {
  for (const size of SIZES) {
    const dir = join(outRoot, 'images', String(size));
    mkdirSync(dir, { recursive: true });
    const base = sharp(srcPath).resize({ width: size, withoutEnlargement: true });
    await base.clone().avif({ quality: 55 }).toFile(join(dir, `${slug}.avif`));
    await base.clone().webp({ quality: 78 }).toFile(join(dir, `${slug}.webp`));
    await base.clone().jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, `${slug}.jpg`));
  }
}

export async function buildAtlas(items, outRoot) {
  const rows = Math.ceil(items.length / COLS);
  const composites = [];
  const index = {};
  for (let i = 0; i < items.length; i++) {
    index[items[i].slug] = i;
    const buf = await sharp(items[i].srcPath)
      .resize(TILE, TILE, { fit: 'cover' }).png().toBuffer();
    composites.push({ input: buf, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE });
  }
  mkdirSync(join(outRoot, 'images'), { recursive: true });
  mkdirSync(join(outRoot, 'data'), { recursive: true });
  await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites).png().toFile(join(outRoot, 'images', 'atlas.png'));
  const manifest = { tile: TILE, cols: COLS, rows, index };
  writeFileSync(join(outRoot, 'data', 'atlas.json'), JSON.stringify(manifest));
  return manifest;
}
