import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';

/**
 * Bridge device connectivity into TanStack Query's onlineManager so queries
 * pause/refetch correctly across network drops (spec §10.9). Call once at boot.
 */
export function initOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    });
    return unsubscribe;
  });

  /**
   * App-foreground → TanStack Query's focusManager (Phase 13).
   *
   * MiTow Driver has had this since Phase 12; MiTow's bridge was NetInfo-only, so
   * nothing refetched when the app came back to the foreground — only when the
   * network changed. That is fine for a screen you navigate to, and wrong for
   * the notification bell, whose whole job is to be current the moment you look
   * at it. A push that arrives while the app is backgrounded is exactly the
   * case where the count is stale and no network event fires.
   */
  AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}
