export const adminCommissionKeys = {
  all: ['admin-commission'] as const,
  config: () => [...adminCommissionKeys.all, 'config'] as const,
  history: () => [...adminCommissionKeys.all, 'history'] as const,
  proposals: () => [...adminCommissionKeys.all, 'proposals'] as const,
  /** §9.4.9's preview — keyed on the proposed band set and the window. */
  impact: (bands: string, days: number) =>
    [...adminCommissionKeys.all, 'impact', bands, days] as const,
};
