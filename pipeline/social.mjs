import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Crop position for the OG card. 'attention' biases toward the busiest region;
// adjust to 'centre' or an explicit extract if the visual check (build.mjs step)
// shows the numerals clipped.
export const OG_CROP_POSITION = 'attention';

export async function buildOgCard(srcPath, outPath) {
  if (!existsSync(srcPath)) throw new Error(`og card source missing: ${srcPath}`);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(srcPath)
    .resize(1200, 630, { fit: 'cover', position: OG_CROP_POSITION })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outPath);
}
