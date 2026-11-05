import { describe, expect, it, vi } from 'vitest';
import { prerender } from '@/index';

// A page without <Seo> must fail the build, not ship an empty head.
vi.mock('@pages/About', () => ({ About: () => <div>about without a head</div> }));
vi.stubGlobal('fetch', () => new Promise(() => {}));

describe('prerender without Seo', () => {
  it('rejects a route that renders no <Seo>', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState(null, '', '/about');

    await expect(prerender({ ssr: true, url: '/about', route: { url: '/about' } })).rejects.toThrow(
      /Seo/,
    );
  });
});
