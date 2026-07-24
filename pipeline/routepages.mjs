import { metaTags, SITE_TITLE, SITE_DESCRIPTION, CARD_IMAGE } from './site.mjs';

// Static shells for the three veil destinations: real 200s with real metadata for crawlers and
// link previews, regardless of how the host handles unknown paths. The client app takes over on
// load exactly as it does on day pages (the .static-nav is removed at boot).
export const ROUTE_PAGES = [
  { path: '/attractors/', title: `Attractors — ${SITE_TITLE}`, description: 'Browse all 365 strange attractors, one for every day of 2010.' },
  { path: '/sound/', title: `Sound — ${SITE_TITLE}`, description: 'Music from the attractors — the Chaos of Zen discography and the sonification of all 365 days.' },
  { path: '/story/', title: `Story — ${SITE_TITLE}`, description: SITE_DESCRIPTION },
  // The host is a plain static file server with no SPA fallback, so every route the emitted nav
  // links to must exist as a real file -- including /today/, which the client-side router
  // replace-redirects to whatever day resolves as "today" (see main.ts/today.ts). This shell is
  // deliberately NOT in the sitemap (sitemap.mjs's list is independent and stays root + attractors/
  // sound/story + days): /today/ is a resolver, not a stable destination, so it must not be indexed
  // as its own page -- hence noindex below.
  { path: '/today/', title: `Today — ${SITE_TITLE}`, description: "Today's strange attractor — the piece for this date in 2010.", noindex: true },
];

export const STATIC_NAV = `<nav class="static-nav">
<a href="/today/">Today</a>
<a href="/attractors/">Attractors</a>
<a href="/sound/">Sound</a>
<a href="/story/">Story</a>
</nav>`;

export function renderRoutePage({ path, title, description, noindex }) {
  const head = metaTags({ title, description, image: CARD_IMAGE, url: path, type: 'website' });
  // The /today/ shell replace-redirects every visitor to a specific day, so it must not be
  // indexed as its own page -- hence the noindex meta, emitted right after ${head} below.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${head}
${noindex ? '<meta name="robots" content="noindex" />\n' : ''}<link rel="stylesheet" href="/assets/index.css" />
</head>
<body>
<canvas id="gl"></canvas>
<div id="overlay">
${STATIC_NAV}
</div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
