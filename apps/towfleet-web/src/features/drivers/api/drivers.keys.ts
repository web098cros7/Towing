export const driversKeys = {
  all: ['drivers'] as const,
  list: () => [...driversKeys.all, 'list'] as const,
  performance: (driverId: string) => [...driversKeys.all, 'performance', driverId] as const,
};
