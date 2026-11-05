import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { OG_IMAGE_PATH, SITE_URL } from '@/constants';
import { canonicalUrl } from '@/routes';

interface SeoProps {
  title: string;
  description: string;
  noindex?: boolean;
}

// vite-prerender-plugin writes `title` into <title> and appends each element
// to <head>.
// https://github.com/preactjs/vite-prerender-plugin#advanced-prerender-options
export interface PageHead {
  title: string;
  elements: Set<{ type: string; props: Record<string, string> }>;
}

// prerender() provides the object and the rendered page's Seo fills it. The
// client has no provider and reads null.
export const SeoCollector = createContext<{ head?: PageHead } | null>(null);

const meta = (props: Record<string, string>) => ({ type: 'meta', props });

const toHead = (
  { title, description, noindex = false }: SeoProps,
  canonical: string | undefined,
): PageHead => {
  const image = `${SITE_URL}${OG_IMAGE_PATH}`;
  return {
    title,
    elements: new Set([
      meta({ name: 'description', content: description }),
      ...(noindex ? [meta({ name: 'robots', content: 'noindex, nofollow' })] : []),
      ...(canonical ? [{ type: 'link', props: { rel: 'canonical', href: canonical } }] : []),
      meta({ property: 'og:type', content: 'website' }),
      meta({ property: 'og:title', content: title }),
      meta({ property: 'og:description', content: description }),
      meta({ property: 'og:image', content: image }),
      ...(canonical ? [meta({ property: 'og:url', content: canonical })] : []),
      meta({ name: 'twitter:card', content: 'summary_large_image' }),
      meta({ name: 'twitter:title', content: title }),
      meta({ name: 'twitter:description', content: description }),
      meta({ name: 'twitter:image', content: image }),
    ]),
  };
};

// Renders nothing. During prerender it fills the collector. On the client it
// sets document.title for the current route.
export const Seo = (props: SeoProps) => {
  const { path } = useLocation();
  const collector = useContext(SeoCollector);
  if (collector) collector.head = toHead(props, canonicalUrl(path));

  useEffect(() => {
    document.title = props.title;
  }, [props.title]);

  return null;
};
