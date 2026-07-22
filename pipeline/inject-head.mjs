import { metaTags, SITE_TITLE, SITE_DESCRIPTION, CARD_IMAGE } from './site.mjs';

export function injectHead(html) {
  const head = metaTags({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    image: CARD_IMAGE,
    url: '/',
    type: 'website',
  });
  return html.replace('<!-- site-head -->', head);
}
