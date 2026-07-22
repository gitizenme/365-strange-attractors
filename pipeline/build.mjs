import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDays } from './manifest.mjs';
import { makeDerivatives, buildAtlas } from './images.mjs';
import { buildAttractors } from './attractors.mjs';
import { buildOgCard, buildFavicons } from './social.mjs';
import { renderSitemap } from './sitemap.mjs';

const ARCHIVE = resolve('..');
const OUT = resolve('public');
const force = process.argv.includes('--force');

const days = buildDays(
  readFileSync(join(ARCHIVE, '365ImageList.csv'), 'utf8'),
  readdirSync(join(ARCHIVE, 'generated')),
);
mkdirSync(join(OUT, 'data'), { recursive: true });
writeFileSync(join(OUT, 'data', 'days.json'), JSON.stringify(days));
console.log(`manifest: ${days.length} days`);

let made = 0;
for (const d of days) {
  const src = join(ARCHIVE, 'generated', d.sourceImage);
  if (force || !existsSync(join(OUT, 'images', '256', `${d.slug}.jpg`))) {
    await makeDerivatives(src, d.slug, OUT);
    made++;
  }
}
console.log(`derivatives: ${made} generated, ${days.length - made} cached`);

await buildAtlas(days.map(d => ({ slug: d.slug, srcPath: join(ARCHIVE, 'generated', d.sourceImage) })), OUT);
console.log('atlas written');

execFileSync('pipeline/.venv/bin/python', [
  'pipeline/analyze.py',
  join(OUT, 'data', 'days.json'),
  join(OUT, 'images', '256'),
  join(OUT, 'data', 'analysis.json'),
], { stdio: 'inherit' });

const analysis = JSON.parse(readFileSync(join(OUT, 'data', 'analysis.json'), 'utf8'));
const bySlug = new Map(analysis.map(a => [a.slug, a]));
const artworks = days.map(d => {
  const a = bySlug.get(d.slug);
  return { day: d.day, title: d.title, slug: d.slug, palette: a.palette, brightness: a.brightness, x: a.x, y: a.y };
});
writeFileSync(join(OUT, 'data', 'artworks.json'), JSON.stringify(artworks));
console.log(`artworks.json: ${artworks.length} entries`);

import { renderPiecePage } from './pages.mjs';
for (const a of artworks) {
  const dir = join(OUT, 'day', a.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderPiecePage(a));
}
console.log(`pages: ${artworks.length} written`);

const attractors = buildAttractors(days, ARCHIVE, { readdirSync, readFileSync });
writeFileSync(join(OUT, 'data', 'attractors.json'), JSON.stringify(attractors));
const inScope = attractors.filter(a => a.system !== 'static-only').length;
console.log(`attractors.json: ${attractors.length} entries, ${inScope} in-scope`);

if (force || !existsSync(join(OUT, 'og', 'card.jpg'))) {
  await buildOgCard(join(ARCHIVE, 'mosaic', '365_Moaic_No_Watermark.png'), join(OUT, 'og', 'card.jpg'));
  console.log('og card written');
} else {
  console.log('og card cached');
}

if (force || !existsSync(join(OUT, 'favicon.ico'))) {
  await buildFavicons(join(ARCHIVE, 'generated', '086_Medusa.jpg'), OUT);
  console.log('favicons written');
} else {
  console.log('favicons cached');
}

writeFileSync(join(OUT, 'sitemap.xml'), renderSitemap(days));
console.log(`sitemap.xml: ${days.length + 1} urls`);
