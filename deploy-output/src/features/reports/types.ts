import type {
  DriverReportRow,
  PeriodReportRow,
  ReportGranularity,
  ReportGroupBy,
  ReportQuery,
  ReportResponse,
  TruckReportRow,
} from '@towing/api-contracts';

export type { DriverReportRow, PeriodReportRow, TruckReportRow };
export type { ReportGranularity, ReportGroupBy, ReportQuery, ReportResponse };

/** The console's period presets, resolved to concrete IST dates before the call. */
export type PeriodPreset = 'last7' | 'last30' | 'quarter' | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  quarter: 'This quarter',
  custom: 'Custom',
};

export const GROUP_LABELS: Record<ReportGroupBy, string> = {
  truck: 'Per truck',
  driver: 'Per driver',
  period: 'Per period',
};

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** IST calendar date of an instant, as `YYYY-MM-DD` — matches the projection's grain. */
export function istDate(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function resolvePreset(preset: Exclude<PeriodPreset, 'custom'>): {
  from: string;
  to: string;
} {
  const to = istDate();

  if (preset === 'quarter') {
    const now = new Date(Date.now() + IST_OFFSET_MS);
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    const from = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))
      .toISOString()
      .slice(0, 10);
    return { from, to };
  }

  const days = preset === 'last7' ? 6 : 29;
  return { from: istDate(new Date(Date.now() - days * 86_400_000)), to };
}
