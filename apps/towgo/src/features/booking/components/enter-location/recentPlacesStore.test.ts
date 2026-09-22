import type { RecentLocation } from '../../data/recentLocations.data';

/**
 * The device's disk. It lives out here, outside the module registry, because
 * `jest.resetModules()` would otherwise re-create the real storage singleton
 * along with everything else — wiping the very thing the restart is supposed
 * to preserve, and making these tests pass for the wrong reason.
 */
const mockDisk = new Map<string, string>();

jest.mock('@/lib/storage/storage', () => ({
  storage: {
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    delete: (key: string) => {
      mockDisk.delete(key);
    },
  },
}));

/**
 * Recent places have to outlive the process.
 *
 * A "restart" here is `jest.resetModules()` plus a fresh `require` of the
 * store: the module re-evaluates and reads storage again, exactly as a cold
 * launch does. The disk above survives that reset; the app does not, which is
 * the asymmetry a cold launch actually has.
 */

const STORAGE_KEY = 'places.recent.v1';

/**
 * Live-backend mode, where the list starts empty. Mock mode seeds it with the
 * rows Figma draws, which would make every assertion below a statement about
 * the fixture rather than about persistence; the last test covers that path.
 */
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual('@/lib/env');
  return { ...actual, env: { ...actual.env, useMocks: false } };
});

function loadStore() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./recentPlacesStore') as typeof import('./recentPlacesStore');
}

const place = (id: string, name: string): RecentLocation => ({
  id,
  name,
  address: 'Bengaluru',
  coords: { latitude: 12.97, longitude: 77.59 },
  value: `${name}, Bengaluru`,
});

describe('recent places, across a restart', () => {
  beforeEach(() => {
    mockDisk.clear();
    jest.resetModules();
  });

  it('remembers a place that was picked but never booked', () => {
    const { useRecentPlacesStore } = loadStore();
    useRecentPlacesStore.getState().addRecent(place('a', 'Indiranagar'));

    jest.resetModules();
    const restarted = loadStore();

    expect(restarted.useRecentPlacesStore.getState().recents.map((r) => r.name)).toEqual([
      'Indiranagar',
    ]);
  });

  it('keeps the newest pick first and does not duplicate a repeat', () => {
    const { useRecentPlacesStore } = loadStore();
    useRecentPlacesStore.getState().addRecent(place('a', 'Indiranagar'));
    useRecentPlacesStore.getState().addRecent(place('b', 'Koramangala'));
    useRecentPlacesStore.getState().addRecent(place('a', 'Indiranagar'));

    jest.resetModules();
    const restarted = loadStore();

    expect(restarted.useRecentPlacesStore.getState().recents.map((r) => r.name)).toEqual([
      'Indiranagar',
      'Koramangala',
    ]);
  });

  it('does not undo a clear on the next launch', () => {
    const { useRecentPlacesStore } = loadStore();
    useRecentPlacesStore.getState().addRecent(place('a', 'Indiranagar'));
    useRecentPlacesStore.getState().clearRecents();

    jest.resetModules();
    const restarted = loadStore();
    const state = restarted.useRecentPlacesStore.getState();

    expect(state.recents).toEqual([]);
    // The instant of the clear is remembered too, or trip history from before
    // it would reappear on the next launch.
    expect(typeof state.clearedAt).toBe('number');
  });

  it('falls back to the default rather than failing when stored data is unreadable', () => {
    mockDisk.set(STORAGE_KEY, '{ not json');
    const { useRecentPlacesStore } = loadStore();

    expect(useRecentPlacesStore.getState().recents).toEqual([]);
    expect(useRecentPlacesStore.getState().clearedAt).toBeNull();
  });
});

describe('recent places, in mock mode', () => {
  beforeEach(() => {
    mockDisk.clear();
    jest.resetModules();
  });

  it('still seeds the drawn rows when nothing has been stored yet', () => {
    jest.doMock('@/lib/env', () => {
      const actual = jest.requireActual('@/lib/env');
      return { ...actual, env: { ...actual.env, useMocks: true } };
    });
    const { useRecentPlacesStore } = loadStore();

    expect(useRecentPlacesStore.getState().recents.length).toBeGreaterThan(0);
  });
});
