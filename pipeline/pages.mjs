const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPiecePage(a) {
  const num = String(a.day).padStart(3, '0');
  const t = esc(a.title);
  const name = `${t} — ${num}/365`;
  const srcset = ext => `/images/1024/${a.slug}.${ext} 1024w, /images/2000/${a.slug}.${ext} 2000w`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} Strange Attractors</title>
<meta property="og:title" content="${name} Strange Attractors" />
<meta property="og:type" content="article" />
<meta property="og:image" content="/images/1024/${a.slug}.jpg" />
<meta name="description" content="${t}, a strange attractor created on day ${a.day} of 365 in 2010." />
<link rel="stylesheet" href="/assets/index.css" />
</head>
<body>
<canvas id="gl"></canvas>
<div id="overlay">
<figure class="static-piece">
<picture>
<source type="image/avif" srcset="${srcset('avif')}" />
<source type="image/webp" srcset="${srcset('webp')}" />
<img src="/images/1024/${a.slug}.jpg" srcset="${srcset('jpg')}"
     alt="${t} — strange attractor, day ${a.day} of 365, 2010" />
</picture>
<figcaption>${name} · 2010</figcaption>
</figure>
</div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
