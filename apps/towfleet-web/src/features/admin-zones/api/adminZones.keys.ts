export const adminZonesKeys = {
  all: ['admin-zones'] as const,
  list: () => [...adminZonesKeys.all, 'list'] as const,
  versions: (zoneId: string) => [...adminZonesKeys.all, 'versions', zoneId] as const,
};
