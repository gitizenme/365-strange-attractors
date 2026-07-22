import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pngToIco from 'png-to-ico';

// The "365" numerals in the source mosaic span the full frame edge-to-edge in
// both dimensions, so no crop (any position keyword) can show them whole at
// the card's wider aspect ratio. Instead: a blurred, darkened cover-fit copy
// fills the frame as background, and the untouched mosaic is scaled to fit
// entirely within the frame (by height) and composited on top, letterboxed
// by the blurred fill rather than hard black bars.
export async function buildOgCard(srcPath, outPath) {
  if (!existsSync(srcPath)) throw new Error(`og card source missing: ${srcPath}`);
  mkdirSync(dirname(outPath), { recursive: true });

  const background = await sharp(srcPath)
    .resize(1200, 630, { fit: 'cover' })
    .blur(25)
    .modulate({ brightness: 0.5 })
    .toBuffer();

  const foreground = await sharp(srcPath)
    .resize(1200, 630, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(background)
    .composite([{ input: foreground }])
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

  const icoPngs = await Promise.all([16, 32, 48].map(s => base.clone().resize(s, s).png().toBuffer()));
  writeFileSync(join(outRoot, 'favicon.ico'), await pngToIco(icoPngs));

  const png64 = await base.clone().resize(64, 64).png().toBuffer();
  writeFileSync(join(outRoot, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${png64.toString('base64')}"/></svg>\n`);
}
