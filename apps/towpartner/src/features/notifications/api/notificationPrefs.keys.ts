export const notificationPrefKeys = {
  all: ['notification-prefs'] as const,
  detail: () => ['notification-prefs', 'detail'] as const,
};
