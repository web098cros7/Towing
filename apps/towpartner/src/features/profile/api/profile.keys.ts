export const profileKeys = {
  all: ['profile'] as const,
  /** The profile CARD (the app's shaped view). */
  card: () => ['profile', 'card'] as const,
  /** The raw `driver/me` contract. A separate key: the two shapes must never share a cache entry. */
  me: () => ['profile', 'me'] as const,
};
