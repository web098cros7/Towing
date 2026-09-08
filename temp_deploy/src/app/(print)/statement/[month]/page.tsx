'use client';

import { use } from 'react';
import { useEarningsSplits, useEarningsSummary } from '@/features/earnings/api/earnings.queries';
import { useFleetSettings } from '@/features/settings/api/settings.queries';
import { formatPaise } from '@/lib/money';

/** Last calendar day of a `YYYY-MM` month, leap years included. */
function monthBounds(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * §9.3.7's "monthly statement export (CSV/PDF)" — the PDF half, as a
 * print-optimized page. `window.print()` gives the operator their platform's
 * own print-to-PDF, which handles fonts, page size and margins better than a
 * bundled renderer would, at zero dependency cost.
 *
 * §9.3.8's AC — "exports contain no customer PII beyond what invoices require"
 * — applies here as much as to the CSV: job code, date, driver and money. No
 * customer name, phone or pickup address.
 */
export default function StatementPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = use(params);
  const range = monthBounds(month);

  const settings = useFleetSettings();
  const summary = useEarningsSummary(range);
  const splits = useEarningsSplits(range);

  const monthLabel = new Date(`${range.from}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const rows = splits.data ?? [];
  const totals = summary.data?.totals;

  return (
    <div>
      <div data-print="hide" className="mb-6 flex items-center justify-between border-b pb-4">
        <p className="text-sm text-gray-600">
          Use your browser&rsquo;s print dialog to save this statement as a PDF.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Print / Save as PDF
        </button>
      </div>

      <header className="mb-8 flex items-start justify-between gap-6 border-b border-gray-300 pb-4">
        <div>
          <h1 className="text-xl font-bold">{settings.data?.businessName ?? 'Fleet statement'}</h1>
          {settings.data?.address ? (
            <p className="mt-1 max-w-sm text-xs text-gray-600">{settings.data.address}</p>
          ) : null}
          {settings.data?.gstin ? (
            <p className="mt-1 text-xs text-gray-600">GSTIN: {settings.data.gstin}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide">Earnings statement</p>
          <p className="text-sm">{monthLabel}</p>
          <p className="mt-1 text-xs text-gray-600">
            {range.from} to {range.to}
          </p>
        </div>
      </header>

      {totals ? (
        <section className="mb-8 grid grid-cols-4 gap-4 border-b border-gray-300 pb-6 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-600">Settled jobs</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{totals.jobs}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-600">Gross fares</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {formatPaise(totals.grossPaise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-600">Platform commission</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              −{formatPaise(totals.commissionPaise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-600">Fleet share</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {formatPaise(totals.fleetSharePaise)}
            </dd>
          </div>
        </section>
      ) : null}

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-400 text-left">
            <th className="py-2 pr-3 font-semibold">Job</th>
            <th className="py-2 pr-3 font-semibold">Settled</th>
            <th className="py-2 pr-3 font-semibold">Driver</th>
            <th className="py-2 pr-3 text-right font-semibold">Gross</th>
            <th className="py-2 pr-3 text-right font-semibold">Commission</th>
            <th className="py-2 pr-3 text-right font-semibold">Driver share</th>
            <th className="py-2 text-right font-semibold">Fleet share</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-gray-600">
                {splits.isLoading ? 'Loading…' : 'No settled jobs in this period.'}
              </td>
            </tr>
          ) : (
            rows.map((split) => (
              <tr key={split.bookingId} className="border-b border-gray-200">
                <td className="py-1.5 pr-3">{split.jobCode}</td>
                <td className="py-1.5 pr-3">{split.settledAt.slice(0, 10)}</td>
                <td className="py-1.5 pr-3">{split.driverName ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatPaise(split.grossPaise)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  −{formatPaise(split.commissionPaise)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatPaise(split.driverSharePaise)}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatPaise(split.fleetSharePaise)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <footer className="mt-8 border-t border-gray-300 pt-4 text-[10px] text-gray-600">
        <p>
          Generated by TowFleet on {new Date().toLocaleDateString('en-IN')}. Amounts are in Indian
          rupees. Commission is applied per §3.3 band at the time each booking was confirmed.
        </p>
      </footer>
    </div>
  );
}
