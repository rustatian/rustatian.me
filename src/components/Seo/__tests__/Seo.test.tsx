import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '@/components/AppRoutes/AppRoutes';
import { Layout } from '@/components/Layout/Layout';

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(
    <LocationProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </LocationProvider>,
  );
};

describe('Seo on the client', () => {
  it('resolves a trailing-slash URL, which the asset host redirects to', () => {
    renderAt('/contact/');
    expect(document.title).toBe('contact · rustatian');
  });

  it('follows client-side navigation', async () => {
    renderAt('/about');
    expect(document.title).toBe('about · rustatian');

    fireEvent.click(screen.getByRole('link', { name: /03\s*contact/i }));

    await waitFor(() => expect(document.title).toBe('contact · rustatian'));
  });
});
