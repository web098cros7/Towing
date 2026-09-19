'use client';

import { Card, CardContent, CardHeader, CardTitle, RelativeTime, Skeleton } from '@towing/web-ui';
import { useAdminCommissionHistory } from '../api/adminCommission.queries';

/**
 * §3.3's "versioned + audited" — the version half, as a table.
 *
 * `oldPct` is null only on the seeded genesis rows: a history that starts at
 * the first EDIT cannot answer "what was it at launch".
 */
export function CommissionHistoryTable() {
  const { data, isLoading } = useAdminCommissionHistory();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <table className="w-full text-sm" data-testid="commission-history">
            <thead>
              <tr className="text-left text-xs text-text-secondary uppercase">
                <th className="py-1">When</th>
                <th className="py-1">Band</th>
                <th className="py-1">Change</th>
                <th className="py-1">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((entry) => (
                <tr key={entry.id} className="border-t border-border" data-testid="commission-history-row">
                  <td className="py-1.5">
                    <RelativeTime at={entry.createdAt} className="text-text-secondary" />
                  </td>
                  <td className="py-1.5">{entry.band}</td>
                  <td className="py-1.5 tabular-nums">
                    {entry.oldPct === null ? 'launch' : `${entry.oldPct}%`} → {entry.newPct}%
                  </td>
                  <td className="py-1.5 text-text-secondary">{entry.reason ?? '—'}</td>
                </tr>
              ))}
              {(data ?? []).length === 0 ? (
                <tr>
                  <td className="py-2 text-text-secondary" colSpan={4}>
                    No changes recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
