export type FleetAlert = {
  id: string;
  type: 'doc_expiring' | 'doc_expired' | 'truck_idle' | 'payout_failed';
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Console route the alert deep-links to (spec §9.3.2 AC). */
  href: string;
  createdAt: string;
};

export type DashboardSummary = {
  kpis: {
    activeTrucks: number;
    totalTrucks: number;
    jobsToday: number;
    revenueTodayPaise: number;
    utilizationPct: number;
  };
  alerts: FleetAlert[];
};
