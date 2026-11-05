import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrate, LocationProvider, prerender as ssr } from 'preact-iso';
import { AppRoutes } from './components/AppRoutes/AppRoutes';
import { Layout } from './components/Layout/Layout';
import { type PageHead, SeoCollector } from './components/Seo/Seo';
import './styles/tokens.css';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <LocationProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </LocationProvider>
  </QueryClientProvider>
);

if (typeof window !== 'undefined') {
  const appElement = document.getElementById('app');
  if (appElement) {
    hydrate(<App />, appElement);
  }
}

export async function prerender(data: unknown) {
  const collector: { head?: PageHead } = {};
  try {
    const result = await ssr(
      <SeoCollector.Provider value={collector}>
        <App />
      </SeoCollector.Provider>,
    );
    if (!collector.head) {
      throw new Error('The route rendered no <Seo>, so its page has no head');
    }
    return { ...result, head: collector.head };
  } catch (error) {
    // The plugin runs prerender once per route. Without this log line the
    // build stack trace does not say which URL broke the SSG pass.
    console.error('prerender failed', {
      data,
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    throw error;
  }
}
