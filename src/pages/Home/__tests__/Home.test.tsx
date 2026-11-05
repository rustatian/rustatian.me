import { Home } from '@pages/Home';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

const renderHome = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocationProvider>
        <Home />
      </LocationProvider>
    </QueryClientProvider>,
  );
};

describe('Home when both queries fail', () => {
  it('shows each failure inline', async () => {
    renderHome();

    // The stats meta line carries the user query's message.
    expect(await screen.findByText('// Network unreachable — check your connection')).toBeTruthy();
    expect(screen.getAllByText('err')).toHaveLength(3);

    // The grid carries the contributions query's message.
    expect(await screen.findByText('Contributions unavailable')).toBeTruthy();
    expect(screen.getByText('Network unreachable — check your connection')).toBeTruthy();
  });
});
