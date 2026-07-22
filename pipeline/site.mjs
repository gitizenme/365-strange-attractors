export const ORIGIN = 'https://chaosofzen.dev';
export const SITE_TITLE = '365 Strange Attractors';
export const SITE_DESCRIPTION = 'One strange attractor a day, every day of 2010. 365 fractal works by Joe Chavez, each re-rendered live in your browser from its original 2010 parameter file.';
export const AUTHOR = 'Joe Chavez';
export const CARD_IMAGE = {
  path: '/og/card.jpg', width: 1200, height: 630,
  alt: 'Photomosaic of all 365 strange attractors forming the numerals 365',
};

export const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const abs = p => p.startsWith('http') ? p : ORIGIN + p;

export function metaTags({ title, description, image, url, type }) {
  const lines = [
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="author" content="${esc(AUTHOR)}" />`,
    `<link rel="canonical" href="${abs(url)}" />`,
    `<meta property="og:site_name" content="${esc(SITE_TITLE)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:url" content="${abs(url)}" />`,
    `<meta property="og:image" content="${abs(image.path)}" />`,
  ];
  if (image.width && image.height) {
    lines.push(`<meta property="og:image:width" content="${image.width}" />`);
    lines.push(`<meta property="og:image:height" content="${image.height}" />`);
  }
  if (image.alt) lines.push(`<meta property="og:image:alt" content="${esc(image.alt)}" />`);
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${abs(image.path)}" />`,
    `<link rel="icon" href="/favicon.ico" sizes="32x32" />`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
  );
  return lines.join('\n');
}
