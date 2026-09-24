import * as Location from 'expo-location';
import { useLocationStore } from './locationStore';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('@/features/places/api/placesDataSource', () => ({
  placesDataSource: {
    reverse: jest.fn(async () => ({
      label: 'Satsang Nagar',
      address: 'Satsang Nagar, Muzaffarpur',
    })),
  },
}));

const fix = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } });

describe('resolveCurrentLocation', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    useLocationStore.setState(useLocationStore.getInitialState());
  });

  it('shares one GPS request between callers', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fix(26.12, 85.36));
    const { resolveCurrentLocation } = useLocationStore.getState();
    await Promise.all([resolveCurrentLocation(), resolveCurrentLocation()]);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(useLocationStore.getState().status).toBe('ready');
    expect(useLocationStore.getState().pickup.coords).toEqual({
      latitude: 26.12,
      longitude: 85.36,
    });
  });

  it('never waits forever: a hung GPS keeps the last known fix', async () => {
    jest.useFakeTimers();
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fix(26.1, 85.3));
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const done = useLocationStore.getState().resolveCurrentLocation();
    await jest.advanceTimersByTimeAsync(10_000);
    await done;
    expect(useLocationStore.getState().status).toBe('ready');
    expect(useLocationStore.getState().pickup.coords).toEqual({ latitude: 26.1, longitude: 85.3 });
  });

  it('with no fix at all it stops locating, so the field asks instead', async () => {
    jest.useFakeTimers();
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const done = useLocationStore.getState().resolveCurrentLocation();
    await jest.advanceTimersByTimeAsync(10_000);
    await done;
    expect(useLocationStore.getState().status).toBe('denied');
  });
});
