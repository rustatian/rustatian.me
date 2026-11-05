import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { GITHUB } from '@/constants';
import { PAGES } from '@/routes';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ComponentChildren;
}

// Evaluated once per module load: at build time in Node for the prerendered
// HTML, and again in the browser at page load. Across a year-boundary deploy the
// two differ and Preact silently rewrites the text node on hydration, so the
// stale year is only visible pre-hydration and to crawlers until the next build.
const CURRENT_YEAR = new Date().getFullYear();

export const Layout = ({ children }: LayoutProps) => {
  const { path } = useLocation();

  return (
    <div className={styles.layout}>
      <a href="#main" className={styles.skipLink}>
        Skip to main content
      </a>
      <nav className={styles.nav} aria-label="Primary">
        <div className={styles.inner}>
          <a href="/" className={styles.brand} aria-label="Home">
            <span className={styles.prompt}>~</span>
            <span className={styles.path}>rustatian</span>
          </a>
          <div className={styles.links}>
            {PAGES.map((page, index) => {
              const current = path === page.path;
              return (
                <a
                  key={page.path}
                  href={page.path}
                  className={styles.link}
                  {...(current ? { 'aria-current': 'page' as const } : {})}
                >
                  <span className={styles.linkNum}>{String(index + 1).padStart(2, '0')}</span>
                  <span>{page.label}</span>
                </a>
              );
            })}
          </div>
          <div className={styles.actions}>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <main id="main" className={styles.main}>
        {children}
      </main>

      <footer className={styles.footer}>
        <div className={`container ${styles.footerGrid}`}>
          <div>© {CURRENT_YEAR} rustatian · Built with care in Geist + Geist Mono</div>
          <div className={styles.footerLinks}>
            <a href="/contact" className="link">
              contact
            </a>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="link">
              github
            </a>
            <span className="muted">v2.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
