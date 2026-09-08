export const adminDriversKeys = {
  all: ['admin-drivers'] as const,
  pending: () => [...adminDriversKeys.all, 'pending'] as const,
};
