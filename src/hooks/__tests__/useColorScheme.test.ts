import { act, renderHook } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, useColorScheme } from '../useColorScheme';

const setSystemPrefersDark = (prefersDark: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark')
        ? prefersDark
        : query.includes('light')
          ? !prefersDark
          : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('useColorScheme', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    setSystemPrefersDark(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without hydration mismatch; reconciles on mount', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(['light', 'dark']).toContain(result.current.theme);
    expect(result.current.mounted).toBe(true);
  });

  it('reads light theme from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads dark theme from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to system preference when storage is empty', () => {
    setSystemPrefersDark(true);
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('does not persist the system preference without an explicit toggle', () => {
    setSystemPrefersDark(true);
    renderHook(() => useColorScheme());

    // Writing on mount latched whatever the OS reported on the first visit; the
    // stored value then won forever and a later OS switch was never picked up.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('follows OS changes while no explicit preference is stored', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_: string, fn: (event: MediaQueryListEvent) => void) =>
          listeners.push(fn),
        ),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('dark');

    act(() => {
      for (const fn of listeners) fn({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current.theme).toBe('light');
  });

  it('stops following the OS once the user has toggled', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_: string, fn: (event: MediaQueryListEvent) => void) =>
          listeners.push(fn),
        ),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useColorScheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');

    act(() => {
      for (const fn of listeners) fn({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current.theme).toBe('light');
  });

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(STORAGE_KEY, 'tangerine');
    setSystemPrefersDark(true);
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('dark');
  });

  it('toggle flips and persists theme, updating data-theme attribute', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.theme).toBe('light');

    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('does not throw when localStorage.setItem raises (e.g. private mode)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useColorScheme());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.theme).toBe('dark');
    setItemSpy.mockRestore();
  });
});
