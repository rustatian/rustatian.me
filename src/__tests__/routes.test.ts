import { describe, expect, it } from 'vitest';
import { sitemapXml } from '@/routes';

describe('sitemapXml', () => {
  // https://www.sitemaps.org/protocol.html
  it('lists every page by its canonical URL', () => {
    expect(sitemapXml()).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url><loc>https://rustatian.me/</loc></url>',
        '  <url><loc>https://rustatian.me/about/</loc></url>',
        '  <url><loc>https://rustatian.me/contact/</loc></url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
  });
});
