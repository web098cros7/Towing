export const privacyKeys = {
  export: () => ['privacy', 'export'] as const,
  /** Per account: a different customer on the same phone is a different answer. */
  consent: (userId: string) => ['privacy', 'consent', userId] as const,
};
