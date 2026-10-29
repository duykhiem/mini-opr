import type { KeyValueStore } from "./syncClient.ts";

// Storage for running the sync client outside a browser, as in tests.
export function memoryStorage(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}
