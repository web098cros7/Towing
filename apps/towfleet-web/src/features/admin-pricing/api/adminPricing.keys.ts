export const adminPricingKeys = {
  all: ['admin-pricing'] as const,
  config: () => [...adminPricingKeys.all, 'config'] as const,
  /** §9.4.8's "saved (versioned)" — the audit feed for `pricing_config`. */
  history: () => [...adminPricingKeys.all, 'history'] as const,
};
