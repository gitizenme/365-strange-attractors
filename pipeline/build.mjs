import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDays } from './manifest.mjs';
import { makeDerivatives, buildAtlas } from './images.mjs';

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
