'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@towing/web-ui';
import { formatPaise } from '@/lib/money';
import { useAdminInvariants } from '../api/adminFinance.queries';

/**
 * §14.1's five invariants, live.
 *
 * THESE ARE NOT A NEW IMPLEMENTATION. The endpoint runs the same
 * `ledgerInvariants` query the nightly reconciliation job and the test suite
 * assert — three consumers, one definition. A non-zero drift is a COUNT of
 * offending rows, exact by construction, so anything but zero is a bug and
 * never rounding noise.
 *
 * The drifted-wallets list is bounded server-side: a systemic bug must not
 * dump every wallet into a browser tab, and the count above IS the honest
 * total when it does.
 */
export function InvariantsPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useAdminInvariants();

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Ledger invariants</CardTitle>
          {data ? (
            <Badge variant={data.ok ? 'success' : 'error'} data-testid="invariants-status">
              {data.ok ? 'All zero' : 'DRIFT DETECTED'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isError ? (
          <p className="text-sm text-error">Could not run the invariants check.</p>
        ) : isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <ul className="flex flex-col gap-1.5" data-testid="invariants-list">
              {data.invariants.map((entry) => (
                <li
                  key={entry.key}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-b-0"
                >
                  <span className="text-text-secondary">{entry.label}</span>
                  <span
                    className={
                      entry.drift === 0
                        ? 'font-semibold tabular-nums text-success-soft-fg'
                        : 'font-semibold tabular-nums text-error'
                    }
                  >
                    {entry.drift}
                  </span>
                </li>
              ))}
            </ul>

            {data.driftedWallets.length > 0 ? (
              <div className="mt-3">
                <h4 className="text-sm font-semibold text-error">Drifted wallets</h4>
                <ul className="mt-1 flex flex-col gap-1 text-xs" data-testid="drifted-wallets">
                  {data.driftedWallets.map((wallet) => (
                    <li key={wallet.walletId} className="tabular-nums">
                      {wallet.ownerType} {wallet.ownerId.slice(0, 8)}… — cached{' '}
                      {formatPaise(wallet.balancePaise)} vs ledger {formatPaise(wallet.ledgerPaise)}{' '}
                      (Δ {formatPaise(wallet.deltaPaise)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-between text-xs text-text-tertiary">
              <span>
                Checked{' '}
                {new Date(data.checkedAt).toLocaleTimeString('en-IN', {
                  timeStyle: 'medium',
                })}
              </span>
              <button
                type="button"
                className="font-medium text-brand underline underline-offset-2"
                onClick={() => void refetch()}
                disabled={isFetching}
                data-testid="invariants-refresh"
              >
                {isFetching ? 'Checking…' : 'Re-check'}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
