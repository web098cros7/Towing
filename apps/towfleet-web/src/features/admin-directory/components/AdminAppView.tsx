'use client';

import { useRouter } from 'next/navigation';
import { Badge, Button, Card } from '@towing/web-ui';
import type {
  AdminAppViewAddressesResponse,
  AdminAppViewNotificationsResponse,
  AdminAppViewTripsResponse,
  AdminAppViewVehiclesResponse,
  AdminAppViewWalletResponse,
} from '@towing/api-contracts';
import { useAdminAppView } from '../api/adminDirectory.queries';
import { useEndImpersonation } from '../api/adminDirectory.mutations';

/** Signed paise for display; the customer app formats the same way. */
const inr = (paise: number): string =>
  `${paise < 0 ? '-' : ''}₹${Math.abs(paise / 100).toLocaleString('en-IN')}`;

/**
 * W6/G8's read-only app view: the five sections the customer sees, rendered
 * from the same customer contracts, under a banner that never lets anyone
 * forget the mode. Ending the session is one click and audited.
 */
export function AdminAppView({ userId, sessionId }: { userId: string; sessionId: string }) {
  const router = useRouter();
  const endSession = useEndImpersonation();

  const trips = useAdminAppView<AdminAppViewTripsResponse>(userId, 'trips', sessionId);
  const wallet = useAdminAppView<AdminAppViewWalletResponse>(userId, 'wallet', sessionId);
  const notifications = useAdminAppView<AdminAppViewNotificationsResponse>(
    userId,
    'notifications',
    sessionId,
  );
  const vehicles = useAdminAppView<AdminAppViewVehiclesResponse>(userId, 'vehicles', sessionId);
  const addresses = useAdminAppView<AdminAppViewAddressesResponse>(userId, 'addresses', sessionId);

  const ended = trips.error instanceof Error && /ended|expired/i.test(trips.error.message);

  return (
    <div className="space-y-4" data-testid="admin-app-view">
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error bg-error/10 px-4 py-3"
        data-testid="app-view-banner"
      >
        <div>
          <div className="font-semibold text-error">Read-only impersonation</div>
          <div className="text-sm text-text-secondary">
            You are viewing this customer&apos;s account as they see it. Every section read is
            audited against session <span className="font-mono text-xs">{sessionId}</span>.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => router.push(`/admin/users/${userId}`)}>
            Back to customer
          </Button>
          <Button
            variant="destructive"
            data-testid="app-view-end"
            disabled={endSession.isPending}
            onClick={() =>
              void endSession.mutateAsync({ userId, sessionId }).then(() => {
                router.push(`/admin/users/${userId}`);
              })
            }
          >
            End session
          </Button>
        </div>
      </div>

      {ended ? (
        <Card className="p-6 text-sm text-error" data-testid="app-view-ended">
          This session has ended or expired. Start a new read-only session from the customer page.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5" data-testid="app-view-trips">
            <h2 className="mb-3 font-semibold">Trips</h2>
            {trips.isLoading ? (
              <p className="text-sm text-text-secondary">Loading…</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(trips.data?.items ?? []).map((trip) => (
                  <li key={trip.id} className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{trip.reference}</div>
                      <div className="text-xs text-text-secondary">
                        {trip.pickupAddress ?? 'Pickup'} → {trip.dropAddress ?? '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="neutral">{trip.status}</Badge>
                      <div className="text-xs text-text-secondary">
                        {inr(trip.breakdown.totalPaise)}
                      </div>
                    </div>
                  </li>
                ))}
                {(trips.data?.items ?? []).length === 0 ? (
                  <li className="text-text-secondary">No trips yet.</li>
                ) : null}
              </ul>
            )}
          </Card>

          <Card className="p-5" data-testid="app-view-wallet">
            <h2 className="mb-3 font-semibold">Wallet</h2>
            <div className="mb-3 text-2xl font-semibold">
              {wallet.data ? inr(wallet.data.wallet.balancePaise) : '—'}
            </div>
            <ul className="space-y-2 text-sm">
              {(wallet.data?.transactions ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">{entry.reason ?? entry.type}</span>
                  <span className={entry.amountPaise < 0 ? 'text-error' : 'text-success'}>
                    {inr(entry.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5" data-testid="app-view-notifications">
            <h2 className="mb-3 font-semibold">Notifications</h2>
            <ul className="space-y-3 text-sm">
              {(notifications.data?.items ?? []).map((entry) => (
                <li key={entry.id}>
                  <div className="font-medium">{entry.title}</div>
                  <div className="text-xs text-text-secondary">{entry.body}</div>
                </li>
              ))}
              {(notifications.data?.items ?? []).length === 0 ? (
                <li className="text-text-secondary">No notifications.</li>
              ) : null}
            </ul>
          </Card>

          <Card className="p-5" data-testid="app-view-vehicles">
            <h2 className="mb-3 font-semibold">Vehicles</h2>
            <ul className="space-y-2 text-sm">
              {(vehicles.data?.items ?? []).map((vehicle) => (
                <li key={vehicle.id} className="flex items-center justify-between gap-2">
                  <span>{vehicle.makeModel ?? vehicle.type}</span>
                  <span className="font-mono text-xs text-text-secondary">
                    {vehicle.plate ?? 'no plate'}
                  </span>
                </li>
              ))}
              {(vehicles.data?.items ?? []).length === 0 ? (
                <li className="text-text-secondary">No saved vehicles.</li>
              ) : null}
            </ul>
          </Card>

          <Card className="p-5 lg:col-span-2" data-testid="app-view-addresses">
            <h2 className="mb-3 font-semibold">Addresses</h2>
            <ul className="space-y-2 text-sm">
              {(addresses.data?.items ?? []).map((address) => (
                <li key={address.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{address.label ?? 'Address'}</span> ·{' '}
                    {address.fullAddress}
                  </span>
                  {address.isDefault ? <Badge variant="brand">Default</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
