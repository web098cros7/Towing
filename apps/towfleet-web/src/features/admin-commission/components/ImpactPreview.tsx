'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Money, Select } from '@towing/web-ui';
import type { Band } from '@towing/api-contracts';
import { useCommissionImpact } from '../api/adminCommission.queries';

/**
 * §9.4.9's impact preview — "at last week's volume, Band A 10 %→9 % ≈ −₹X".
 *
 * THE SERVER COMPUTES IT, over actual paid bookings, which is why this panel
 * asks for a set of percentages instead of doing the arithmetic itself: an
 * average-based projection on the client would be easier and would answer a
 * different question.
 *
 * It previews the DRAFT the band editor is showing, so "what I typed" and "what
 * it would have earned" are the same edit.
 */
export function ImpactPreview({ draft }: { draft: Record<Band, string> }) {
  const [days, setDays] = useState(7);
  const [asked, setAsked] = useState(false);

  const bands = (['A', 'B', 'C'] as const)
    .map((band) => `${band}:${Number(draft[band])}`)
    .join(',');
  const valid = (['A', 'B', 'C'] as const).every((band) => Number.isFinite(Number(draft[band])));

  const { data, isFetching, isError } = useCommissionImpact(bands, days, asked && valid);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact preview</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          What the numbers above would have earned on the bookings actually settled in the window —
          not a projection from averages.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-text-secondary">
            Window
            <Select
              value={String(days)}
              onChange={(event) => setDays(Number(event.target.value))}
              data-testid="impact-days"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </label>
          <Button
            variant="secondary"
            disabled={!valid || isFetching}
            onClick={() => setAsked(true)}
            data-testid="impact-preview"
          >
            {isFetching ? 'Calculating…' : 'Preview impact'}
          </Button>
        </div>

        {isError ? <p className="mt-3 text-sm text-error">The preview could not be computed.</p> : null}

        {data ? (
          <table className="mt-4 w-full text-sm" data-testid="impact-table">
            <thead>
              <tr className="text-left text-xs text-text-secondary uppercase">
                <th className="py-1">Band</th>
                <th className="py-1">Bookings</th>
                <th className="py-1">Now</th>
                <th className="py-1">Proposed</th>
                <th className="py-1 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {data.bands.map((band) => (
                <tr key={band.band} className="border-t border-border">
                  <td className="py-1.5">
                    {band.band} · {band.currentPct}% → {band.proposedPct}%
                  </td>
                  <td className="py-1.5 tabular-nums">{band.bookings}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    <Money value={band.currentPaise / 100} exact />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    <Money value={band.proposedPaise / 100} exact />
                  </td>
                  <td
                    className={
                      band.deltaPaise < 0
                        ? 'py-1.5 text-right tabular-nums text-error'
                        : 'py-1.5 text-right tabular-nums text-success-soft-fg'
                    }
                  >
                    {band.deltaPaise < 0 ? '−' : '+'}
                    <Money value={Math.abs(band.deltaPaise) / 100} exact />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <td className="py-2" colSpan={4}>
                  Total over {data.days} days
                </td>
                <td
                  className={
                    data.totalDeltaPaise < 0
                      ? 'py-2 text-right tabular-nums text-error'
                      : 'py-2 text-right tabular-nums text-success-soft-fg'
                  }
                  data-testid="impact-total-delta"
                >
                  {data.totalDeltaPaise < 0 ? '−' : '+'}
                  <Money value={Math.abs(data.totalDeltaPaise) / 100} exact />
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  );
}
