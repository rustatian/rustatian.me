import { NotFound } from '@pages/_404';
import { About } from '@pages/About';
import { Contact } from '@pages/Contact';
import { Home } from '@pages/Home';
import type { AnyComponent } from 'preact';
import { Route, Router } from 'preact-iso';
import { PAGES, type PagePath } from '@/routes';

// Typed by the table so a page without a binding fails the typecheck.
const COMPONENTS: Record<PagePath, AnyComponent> = {
  '/': Home,
  '/about': About,
  '/contact': Contact,
};

// No lazy loading — keeps the prerender output byte-identical to what
// the client hydrates, avoiding Suspense fallbacks in SSG HTML.
//
// That also means preact-iso's onLoadStart/onLoadEnd never fire: it invokes them
// only from its suspend hook, and nothing here suspends. A route-transition
// overlay wired to those callbacks was therefore dead and has been removed.
export const AppRoutes = () => (
  <Router>
    {PAGES.map(page => (
      <Route key={page.path} path={page.path} component={COMPONENTS[page.path]} />
    ))}
    <Route default component={NotFound} />
  </Router>
);
