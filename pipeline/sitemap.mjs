import { ORIGIN } from './site.mjs';

export function renderSitemap(days) {
  const urls = ['/', ...days.map(d => `/day/${d.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `<url><loc>${ORIGIN}${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
}
