/**
 * Key–value storage behind a small interface so the app boots in Expo Go
 * (in-memory fallback) and uses MMKV in a dev/prod build — without touching
 * callers. `new MMKV()` throws in Expo Go (no native module there), so the
 * swap below is guarded by a try/catch rather than assumed.
 */
export interface KVStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

class MemoryStorage implements KVStorage {
  private readonly map = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

function createStorage(): KVStorage {
  try {
    // Deferred require, not a static import: Expo Go has no MMKV native
    // module, and a static import would throw at module-load time (before
    // this try/catch runs) rather than at first construction.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
    const { MmkvStorage } = require('./mmkv') as typeof import('./mmkv');
    return new MmkvStorage();
  } catch {
    return new MemoryStorage();
  }
}

export const storage: KVStorage = createStorage();
