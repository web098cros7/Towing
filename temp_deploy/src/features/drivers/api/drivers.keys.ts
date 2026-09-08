export const driversKeys = {
  all: ['drivers'] as const,
  list: () => [...driversKeys.all, 'list'] as const,
};
