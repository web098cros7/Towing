import type { DashboardSummary } from '../types';

export const dashboardMock: DashboardSummary = {
  kpis: {
    activeTrucks: 6,
    totalTrucks: 8,
    jobsToday: 14,
    revenueTodayPaise: 4_862_000,
    utilizationPct: 68,
  },
  alerts: [
    {
      id: 'al-1',
      type: 'doc_expired',
      severity: 'error',
      message: 'Insurance expired for KA-01-AB-1234 — truck removed from dispatch',
      href: '/trucks',
      createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    },
    {
      id: 'al-2',
      type: 'doc_expiring',
      severity: 'warning',
      message: 'PUC for KA-05-MJ-7788 expires in 12 days',
      href: '/trucks',
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    },
    {
      id: 'al-3',
      type: 'truck_idle',
      severity: 'info',
      message: 'KA-03-QT-5511 has been idle for 2 days',
      href: '/map',
      createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    },
    {
      id: 'al-4',
      type: 'payout_failed',
      severity: 'error',
      message: 'Weekly payout of ₹42,300 failed — bank details need updating',
      href: '/earnings',
      createdAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
    },
  ],
};
