import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pngToIco from 'png-to-ico';

// Crop position for the OG card. 'attention' biases toward the busiest region;
// adjust to 'centre' or an explicit extract if the visual check (build.mjs step)
// shows the numerals clipped.
export const OG_CROP_POSITION = 'centre';

export async function buildOgCard(srcPath, outPath) {
  if (!existsSync(srcPath)) throw new Error(`og card source missing: ${srcPath}`);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(srcPath)
    .resize(1200, 630, { fit: 'cover', position: OG_CROP_POSITION })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outPath);
}

// Favicon renders on light browser chrome, so lift brightness of the dark artwork.
const FAVICON_BRIGHTNESS = 1.25;

export async function buildFavicons(srcPath, outRoot) {
  if (!existsSync(srcPath)) throw new Error(`favicon source missing: ${srcPath}`);
  mkdirSync(outRoot, { recursive: true });
  const base = sharp(srcPath)
    .resize(512, 512, { fit: 'cover' })
    .modulate({ brightness: FAVICON_BRIGHTNESS });

  await base.clone().resize(180, 180).png().toFile(join(outRoot, 'apple-touch-icon.png'));

  const png32 = await base.clone().resize(32, 32).png().toBuffer();
  writeFileSync(join(outRoot, 'favicon.ico'), await pngToIco(png32));

  const png64 = await base.clone().resize(64, 64).png().toBuffer();
  writeFileSync(join(outRoot, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${png64.toString('base64')}"/></svg>\n`);
}
