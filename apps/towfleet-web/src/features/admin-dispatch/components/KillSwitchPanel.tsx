'use client';

import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Switch } from '@towing/web-ui';
import type { AdminDispatchConfig } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateKillSwitches } from '../api/adminDispatch.mutations';

/**
 * §19.8's kill switches — the buttons that stop revenue on purpose.
 *
 * EVERY ONE ASKS FIRST, AND SAYS WHAT IT WILL DO. A paused zone refuses new
 * bookings AND revokes the offers in flight there (A11/A12, both fixed and
 * tested); force-polling refuses every socket ticket, which costs battery and
 * fidelity platform-wide; disabling long-distance suppresses the biggest jobs on
 * the platform. None of the three is a toggle anyone should flip by accident.
 *
 * The switch is confirmed INLINE, not in a modal: the operator needs to see
 * which zone they are about to pause while they confirm it.
 */
export function KillSwitchPanel({ config }: { config: AdminDispatchConfig }) {
  const toast = useToast();
  const update = useUpdateKillSwitches();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const apply = async (
    patch: {
      pausedZoneIds?: string[];
      longDistanceDisabled?: boolean;
      forcePolling?: boolean;
      sosStandaloneDisabled?: boolean;
    },
    message: string,
  ) => {
    setErrorMessage(null);
    try {
      await update.mutateAsync(patch);
      setConfirming(null);
      toast(message, 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const paused = new Set(config.killSwitches.pausedZoneIds);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kill switches</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          Every switch here takes effect immediately and is audited. Rehearsed before launch
          (work order §After M4).
        </p>

        <div className="space-y-3">
          {config.zones.map((zone) => {
            const isPaused = paused.has(zone.zoneId);
            const slug = zone.zoneName.replace(/\s+/g, '-').toLowerCase();
            const key = `pause-zone-${slug}`;
            return (
              <div
                key={zone.zoneId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2"
              >
                <div>
                  <span className="text-sm font-semibold">{zone.zoneName}</span>
                  <p className="text-xs text-text-secondary" data-testid={`zone-state-${slug}`}>
                    {confirming === key
                      ? 'New bookings will be refused here and live offers revoked.'
                      : isPaused
                        ? 'New bookings refused here and live offers revoked.'
                        : 'Open for new bookings.'}
                  </p>
                </div>

                {confirming === key ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">
                      {isPaused ? 'Reopen this zone?' : 'Pause this zone?'}
                    </span>
                    <Button
                      size="sm"
                      variant={isPaused ? 'primary' : 'destructive'}
                      onClick={() =>
                        void apply(
                          {
                            pausedZoneIds: isPaused
                              ? [...paused].filter((id) => id !== zone.zoneId)
                              : [...paused, zone.zoneId],
                          },
                          isPaused ? `${zone.zoneName} reopened` : `${zone.zoneName} paused`,
                        )
                      }
                      data-testid={`confirm-${key}`}
                    >
                      Yes, {isPaused ? 'reopen' : 'pause'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant={isPaused ? 'secondary' : 'outline'}
                    disabled={update.isPending}
                    onClick={() => setConfirming(key)}
                    data-testid={key}
                  >
                    {isPaused ? 'Reopen zone' : 'Pause zone'}
                  </Button>
                )}
              </div>
            );
          })}

          <div
            className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2"
            data-testid="kill-long-distance"
          >
            <div>
              <span className="text-sm font-semibold">Disable long-distance offers</span>
              <p className="text-xs text-text-secondary">
                Band C jobs stop being offered platform-wide.
              </p>
            </div>
            <Switch
              checked={config.killSwitches.longDistanceDisabled}
              disabled={update.isPending}
              labelledBy="kill-long-distance-label"
              onCheckedChange={(checked) => setConfirming(checked ? 'long-distance' : null)}
            />
          </div>

          {confirming === 'long-distance' ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-text-secondary">Suppress every long-distance job?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void apply({ longDistanceDisabled: true }, 'Long-distance offers disabled')
                }
                data-testid="confirm-long-distance"
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : null}

          <div
            className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2"
            data-testid="kill-force-polling"
          >
            <div>
              <span className="text-sm font-semibold">Force REST polling</span>
              <p className="text-xs text-text-secondary">
                Refuses every socket ticket, both apps. §19.2's degraded mode.
              </p>
            </div>
            <Switch
              checked={config.killSwitches.forcePolling}
              disabled={update.isPending}
              labelledBy="kill-force-polling-label"
              onCheckedChange={(checked) => {
                if (checked) {
                  setConfirming('force-polling');
                  return;
                }
                void apply({ forcePolling: false }, 'Polling forced off');
              }}
            />
          </div>

          {confirming === 'force-polling' ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-text-secondary">
                Every handset drops to REST. Continue?
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void apply({ forcePolling: true }, 'Polling forced platform-wide')}
                data-testid="confirm-force-polling"
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : null}

          <div
            className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2"
            data-testid="kill-sos-standalone"
          >
            <div>
              <span className="text-sm font-semibold">Disable standalone SOS</span>
              <p className="text-xs text-text-secondary">
                Refuses SOS from users with NO active booking. In-booking SOS keeps working, and
                §13's safety story depends on this staying ON.
              </p>
            </div>
            <Switch
              checked={config.killSwitches.sosStandaloneDisabled}
              disabled={update.isPending}
              labelledBy="kill-sos-standalone-label"
              onCheckedChange={(checked) => {
                if (checked) {
                  setConfirming('sos-standalone');
                  return;
                }
                void apply({ sosStandaloneDisabled: false }, 'Standalone SOS re-enabled');
              }}
            />
          </div>

          {confirming === 'sos-standalone' ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-text-secondary">
                A customer with no booking will not be able to call for help. Continue?
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void apply({ sosStandaloneDisabled: true }, 'Standalone SOS disabled')
                }
                data-testid="confirm-sos-standalone"
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm text-error" role="alert" data-testid="killswitch-error">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
