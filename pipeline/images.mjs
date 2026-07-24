import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [2000, 1024, 256];
const COLS = 20;
const TILE_FULL = 128;
const TILE_SMALL = 32;

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

async function compositeAtlas(items, tile, outPath, quality) {
  const rows = Math.ceil(items.length / COLS);
  const composites = [];
  for (let i = 0; i < items.length; i++) {
    const buf = await sharp(items[i].srcPath)
      .resize(tile, tile, { fit: 'cover' }).png().toBuffer();
    composites.push({ input: buf, left: (i % COLS) * tile, top: Math.floor(i / COLS) * tile });
  }
  await sharp({ create: { width: COLS * tile, height: rows * tile, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites).webp({ quality }).toFile(outPath);
  return rows;
}

// Two tiers from the same tile-compositing loop: a tiny 32px-tile atlas that loads first (whole
// constellation as soft glowing forms in a few hundred ms, even on cellular) and a 128px-tile
// atlas that swaps in when ready (src/constellation.ts owns the swap). No PNG atlas is written
// any more -- the single 12.5 MB atlas.png this replaces was the single biggest blocker to first
// paint (sprites stayed invisible until it fully arrived).
export async function buildAtlas(items, outRoot) {
  const index = {};
  items.forEach((it, i) => { index[it.slug] = i; });
  mkdirSync(join(outRoot, 'images'), { recursive: true });
  mkdirSync(join(outRoot, 'data'), { recursive: true });
  const rows = await compositeAtlas(items, TILE_FULL, join(outRoot, 'images', 'atlas-128.webp'), 78);
  await compositeAtlas(items, TILE_SMALL, join(outRoot, 'images', 'atlas-32.webp'), 85);
  const manifest = {
    tile: TILE_FULL, cols: COLS, rows, index,
    files: { small: '/images/atlas-32.webp', full: '/images/atlas-128.webp' },
  };
  writeFileSync(join(outRoot, 'data', 'atlas.json'), JSON.stringify(manifest));
  return manifest;
}
