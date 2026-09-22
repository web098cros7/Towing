'use client';

import { useState } from 'react';
import { Button, DateRangePicker, FilterBar, Tabs, buttonVariants } from '@towing/web-ui';
import { useAdminCan } from '@/components/admin/Can';
import { adminAnalyticsDataSource } from '../api/adminAnalyticsDataSource';
import { addDays, istToday } from '../mocks/adminAnalytics.mock';
import type { AnalyticsRange } from '../api/adminAnalytics.keys';
import {
  useAnalyticsDrivers,
  useAnalyticsGeo,
  useAnalyticsRevenue,
  useAnalyticsSummary,
} from '../api/adminAnalytics.queries';
import { DriversTab } from './DriversTab';
import { GeoTab } from './GeoTab';
import { MarketplaceTab } from './MarketplaceTab';
import { RevenueTab } from './RevenueTab';
import { SummaryTab } from './SummaryTab';

type Tab = 'summary' | 'marketplace' | 'revenue' | 'drivers' | 'geo';

const EXPORTS = ['summary', 'revenue', 'geo'] as const;

/**
 * `/admin/analytics` — W17's console (§9.4.13).
 *
 * ONE RANGE, FIVE VIEWS. The date range is the panel's state, not each tab's,
 * so switching tabs never silently resets the window an operator set. Every
 * read carries the range; the default is the trailing 30 days, ending today —
 * and "today" is served live by the API, which is why the newest bar moves
 * without a nightly job having run.
 *
 * Exports are plain links (the proxy streams the CSV); they render only for
 * `analytics.export` holders, which is stricter than the view gate by design.
 */
export function AnalyticsPanel() {
  const can = useAdminCan();
  const [range, setRange] = useState<AnalyticsRange>(() => ({
    from: addDays(istToday(), -29),
    to: istToday(),
  }));
  const [tab, setTab] = useState<Tab>('summary');

  const summary = useAnalyticsSummary(range);
  const revenue = useAnalyticsRevenue(range, tab === 'revenue');
  const drivers = useAnalyticsDrivers(range, tab === 'drivers');
  const geo = useAnalyticsGeo(range, tab === 'geo');

  const error = summary.error ?? revenue.error ?? drivers.error ?? geo.error;

  return (
    <div>
      <FilterBar className="mb-4">
        <DateRangePicker
          value={range}
          onChange={(next) =>
            // The picker's halves are nullable while typing; keep the last
            // complete value for whichever half is mid-edit rather than
            // firing a query the API would refuse.
            setRange((current) => ({
              from: next.from ?? current.from,
              to: next.to ?? current.to,
            }))
          }
          fromLabel="From"
          toLabel="To"
        />
        {can('analytics.export') ? (
          <div className="ml-auto flex items-center gap-2">
            {EXPORTS.map((dataset) => (
              <a
                key={dataset}
                data-testid={`export-${dataset}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                href={adminAnalyticsDataSource.exportCsvUrl(dataset, range)}
                download
              >
                {dataset} CSV
              </a>
            ))}
          </div>
        ) : null}
      </FilterBar>

      <Tabs
        items={[
          { value: 'summary', label: 'Summary' },
          { value: 'marketplace', label: 'Marketplace' },
          { value: 'revenue', label: 'Revenue' },
          { value: 'drivers', label: 'Drivers' },
          { value: 'geo', label: 'Geo' },
        ]}
        value={tab}
        onChange={setTab}
        aria-label="Analytics section"
      />

      <div className="mt-4">
        {error ? (
          <div className="space-y-2">
            <p className="text-sm text-error-soft-fg">Could not load analytics.</p>
            <Button variant="secondary" size="sm" onClick={() => void summary.refetch()}>
              Try again
            </Button>
          </div>
        ) : tab === 'summary' ? (
          <SummaryTab data={summary.data} />
        ) : tab === 'marketplace' ? (
          <MarketplaceTab data={summary.data} />
        ) : tab === 'revenue' ? (
          <RevenueTab data={revenue.data} />
        ) : tab === 'drivers' ? (
          <DriversTab data={drivers.data} />
        ) : (
          <GeoTab data={geo.data} />
        )}
      </div>
    </div>
  );
}
