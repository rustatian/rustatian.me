import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import path from 'path';
import preact from '@preact/preset-vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { sitemapXml } from './src/routes';

// Emits sitemap.xml from the page table, next to the prerendered pages.
const sitemap = (): Plugin => ({
  name: 'sitemap',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
  },
});

export default defineConfig(({ mode }) => {
  const plugins: Plugin[] = [
    preact({
      prerender: {
        enabled: true,
        renderTarget: '#app',
        // The crawl reaches every linked page; /404 is unlinked and needs the entry.
        additionalPrerenderRoutes: ['/404'],
        previewMiddlewareEnabled: true,
        previewMiddlewareFallback: '/404',
      },
    }) as unknown as Plugin,
    sitemap(),
  ];

  // Set inline by the `build:analyze` script; no .env file feeds the build config.
  if (process.env.ANALYZE) {
    plugins.push(
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
      }) as unknown as Plugin,
    );
  }

  return {
    plugins,
    build: {
      // Ensure proper output for Cloudflare Workers
      target: 'esnext',
      minify: mode === 'production',
      // No production source maps. `'hidden'` did not do what its name suggests:
      // the .map files were still emitted into dist/, wrangler uploads dist/
      // wholesale, and the worker serves /assets/* — so a 726KB map with full
      // `sourcesContent` was publicly fetchable, and this toolchain emitted the
      // `sourceMappingURL` comment anyway. Nothing consumes them (no error
      // tracker is wired up), so don't produce them.
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 500,
    },
    resolve: {
      // Exclude 'browser' so the client bundle picks universal ESM exports with
      // runtime isBrowser guards: vite-prerender-plugin re-executes that bundle
      // in Node for SSG, and browser-only exports that unconditionally touch
      // `document` crash the build.
      // 'production' and 'development' are mutually exclusive — pick one so
      // packages with both export conditions (react, etc.) resolve correctly.
      conditions: mode === 'production' ? ['module', 'production'] : ['module', 'development'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@pages': path.resolve(__dirname, './src/pages'),
        '@state': path.resolve(__dirname, './src/state'),
        'react': 'preact/compat',
        'react-dom': 'preact/compat',
      },
    },
  }
});
