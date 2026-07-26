import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Cache busting. GitHub Pages pins Cache-Control: max-age=600 with no way to
// customize it, and iOS Safari may reuse a cached subresource without ever
// revalidating — so content behind a stable URL can stay stale on a phone
// until the user clears website data. The fix is to change the URL whenever
// the content changes: vite emits content-hashed bundle names, and every HTML
// shell must reference them.
//
// The pipeline's HTML templates (pages.mjs, routepages.mjs) keep the stable
// placeholder names /assets/app.js + /assets/index.css because they render on
// the artist's machine, where the eventual bundle hash is unknowable. This
// module rewrites every *.html under a site root to whatever hashed bundle
// sits in <root>/assets:
//
//   - `npm run build` runs it on dist/ after vite build,
//   - the CI deploy job runs it on the deploy repo checkout, whose day pages
//     and route shells are pipeline-generated and cannot be rebuilt there.
//
// Rewrites are idempotent and also match names stamped by a previous build,
// which is what makes the CI restamp of old pages safe.

export function findBundle(names) {
  const js = names.filter(n => /^app-[\w-]+\.js$/.test(n));
  const css = names.filter(n => /^index-[\w-]+\.css$/.test(n));
  if (js.length !== 1 || css.length !== 1) {
    throw new Error(
      `expected exactly one app-*.js and one index-*.css in assets/, ` +
      `found js=[${js.join(', ')}] css=[${css.join(', ')}]`,
    );
  }
  return { js: js[0], css: css[0] };
}

export function stampHtml(html, { js, css }) {
  return html
    .replace(/\/assets\/app(?:-[\w-]+)?\.js/g, `/assets/${js}`)
    .replace(/\/assets\/index(?:-[\w-]+)?\.css/g, `/assets/${css}`);
}

function* walkHtml(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkHtml(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

export function stampSite(root) {
  const bundle = findBundle(readdirSync(join(root, 'assets')));
  let seen = 0;
  let changed = 0;
  for (const file of walkHtml(root)) {
    seen++;
    const html = readFileSync(file, 'utf8');
    const stamped = stampHtml(html, bundle);
    if (stamped !== html) {
      writeFileSync(file, stamped);
      changed++;
    }
  }
  return { bundle, seen, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node pipeline/stamp.mjs <site-root>');
    process.exit(1);
  }
  const { bundle, seen, changed } = stampSite(root);
  console.log(`stamp: ${changed}/${seen} html files -> ${bundle.js} + ${bundle.css}`);
}
