import { describe, expect, it, vi } from 'vitest';
import { PROFILE } from '@/data/profile';
import { prerender } from '@/index';

// Home mounts React Query hooks. No query may reach the network from a test.
vi.stubGlobal('fetch', () => new Promise(() => {}));

const SITE = 'https://rustatian.me';
const OG_IMAGE = `${SITE}/og_default.png`;

const prerenderAt = async (url: string) => {
  window.history.replaceState(null, '', url);
  return prerender({ ssr: true, url, route: { url } });
};

const find = (elements: Iterable<{ props: Record<string, string> }>, attr: string, value: string) =>
  [...elements].find(e => e.props[attr] === value);

const cases = [
  {
    name: 'home is indexed with the site root as canonical',
    url: '/',
    title: 'rustatian — home',
    canonical: `${SITE}/`,
  },
  {
    name: 'about keeps the trailing slash in its canonical',
    url: '/about',
    title: 'about · rustatian',
    canonical: `${SITE}/about/`,
  },
  {
    name: 'contact keeps the trailing slash in its canonical',
    url: '/contact',
    title: 'contact · rustatian',
    canonical: `${SITE}/contact/`,
  },
  {
    name: '404 is noindex with no canonical',
    url: '/404',
    title: '404 · rustatian',
    canonical: null,
  },
  {
    name: 'an unknown path renders the 404 head',
    url: '/no-such-page',
    title: '404 · rustatian',
    canonical: null,
  },
];

describe('prerender head', () => {
  it.each(cases)('$name', async ({ url, title, canonical }) => {
    const result = await prerenderAt(url);
    const { elements } = result.head;

    expect(result.head.title).toBe(title);
    expect(find(elements, 'property', 'og:title')?.props.content).toBe(title);
    expect(find(elements, 'property', 'og:image')?.props.content).toBe(OG_IMAGE);

    if (canonical) {
      expect(find(elements, 'rel', 'canonical')?.props.href).toBe(canonical);
      expect(find(elements, 'property', 'og:url')?.props.content).toBe(canonical);
      expect(find(elements, 'name', 'robots')).toBeUndefined();
    } else {
      expect(find(elements, 'rel', 'canonical')).toBeUndefined();
      expect(find(elements, 'property', 'og:url')).toBeUndefined();
      expect(find(elements, 'name', 'robots')?.props.content).toBe('noindex, nofollow');
    }

    // The head belongs to <head>. Nothing may render it into the body.
    expect(result.html).not.toContain('<title');
    expect(result.html).not.toContain('rel="canonical"');
    expect(result.html).not.toContain('og:title');
  });

  it('emits the full tag set for the home page', async () => {
    const result = await prerenderAt('/');
    const meta = (props: Record<string, string>) => ({ type: 'meta', props });

    expect(result.head.elements).toEqual(
      new Set([
        meta({ name: 'description', content: PROFILE.bio }),
        { type: 'link', props: { rel: 'canonical', href: `${SITE}/` } },
        meta({ property: 'og:type', content: 'website' }),
        meta({ property: 'og:title', content: 'rustatian — home' }),
        meta({ property: 'og:description', content: PROFILE.bio }),
        meta({ property: 'og:image', content: OG_IMAGE }),
        meta({ property: 'og:url', content: `${SITE}/` }),
        meta({ name: 'twitter:card', content: 'summary_large_image' }),
        meta({ name: 'twitter:title', content: 'rustatian — home' }),
        meta({ name: 'twitter:description', content: PROFILE.bio }),
        meta({ name: 'twitter:image', content: OG_IMAGE }),
      ]),
    );
  });

  it('does not carry head state from one route into the next', async () => {
    await prerenderAt('/404');
    const result = await prerenderAt('/about');

    expect(result.head.title).toBe('about · rustatian');
    expect(find(result.head.elements, 'name', 'robots')).toBeUndefined();
  });
});
