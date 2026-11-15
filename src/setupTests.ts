import { act, cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

afterEach(() => {
  // Preact 11 defers the useEffect cleanups of an unmounted tree to the next frame. act() runs them now.
  act(() => cleanup());
});

// This jsdom setup exposes `Storage` but leaves `window.localStorage` undefined
// (verified: `typeof window.localStorage === 'undefined'`, `typeof Storage ===
// 'function'`), so anything reading it throws. Install a minimal in-memory
// Storage so theme-persistence code can be exercised.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  // Inherit from Storage.prototype so tests that do `vi.spyOn(Storage.prototype,
  // 'setItem')` still intercept the shim's calls.
  const shim = Object.create(Storage.prototype) as Storage;
  Object.defineProperties(shim, {
    length: { get: () => store.size },
    key: { value: (index: number) => Array.from(store.keys())[index] ?? null },
    getItem: { value: (key: string) => store.get(key) ?? null },
    setItem: { value: (key: string, value: string) => void store.set(key, String(value)) },
    removeItem: { value: (key: string) => void store.delete(key) },
    clear: { value: () => store.clear() },
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: shim,
  });
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
