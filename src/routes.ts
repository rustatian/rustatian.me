import { SITE_URL } from './constants';

// The pages of the site in nav order. The router, the nav, the canonical
// URLs and the sitemap read this table.
export const PAGES = [
  { path: '/', label: 'home' },
  { path: '/about', label: 'about' },
  { path: '/contact', label: 'contact' },
] as const;

export type PagePath = (typeof PAGES)[number]['path'];

// A prerendered page is served from `<path>/index.html`, so its canonical URL
// ends with a slash. A path outside the table, such as the 404 shell, has none.
export const canonicalUrl = (path: string): string | undefined => {
  if (!PAGES.some(page => page.path === path)) return undefined;
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}/`;
};

// https://www.sitemaps.org/protocol.html
export const sitemapXml = (): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PAGES.map(page => `  <url><loc>${canonicalUrl(page.path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
