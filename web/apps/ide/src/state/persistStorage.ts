import type { StateStorage } from 'zustand/middleware';

// Vitest runs the stores without a browser storage backend. A no-op storage
// keeps Zustand persist deterministic in that environment while the browser
// still uses the real localStorage implementation.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function getPersistStorage(): StateStorage {
  if (typeof window === 'undefined') return noopStorage;
  try {
    return window.localStorage;
  } catch {
    return noopStorage;
  }
}
