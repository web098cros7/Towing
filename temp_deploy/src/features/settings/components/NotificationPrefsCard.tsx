'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Switch } from '@towing/web-ui';
import { useUpdateSettings } from '../api/settings.queries';
import { NOTIFICATION_PREF_LABELS, type FleetSettings, type NotificationPrefs } from '../types';

/**
 * §9.3.1's notification preferences.
 *
 * Phase 2 shipped these as `useState` with no save button at all — the toggles
 * were discarded on navigation. They now persist to the `notification_prefs`
 * jsonb column, merged server-side so an older client cannot blank a
 * preference it does not know about.
 */
export function NotificationPrefsCard({
  settings,
  onSaved,
  submitLabel = 'Save preferences',
}: {
  settings: FleetSettings;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(settings.notificationPrefs);
  const [saved, setSaved] = useState(false);
  const update = useUpdateSettings();

  useEffect(() => {
    setPrefs(settings.notificationPrefs);
  }, [settings]);

  const dirty = NOTIFICATION_PREF_LABELS.some(
    ({ key }) => prefs[key] !== settings.notificationPrefs[key],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {NOTIFICATION_PREF_LABELS.map(({ key, label, description }) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-input px-2 py-2.5"
          >
            <div className="min-w-0">
              <div id={`pref-${key}`} className="text-sm">
                {label}
              </div>
              <p className="text-xs text-text-tertiary">{description}</p>
            </div>
            <Switch
              checked={prefs[key]}
              onCheckedChange={(next) => {
                setSaved(false);
                setPrefs((prev) => ({ ...prev, [key]: next }));
              }}
              disabled={update.isPending}
              labelledBy={`pref-${key}`}
            />
          </div>
        ))}

        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={() => {
              setSaved(false);
              update.mutate(
                { notificationPrefs: prefs },
                {
                  onSuccess: () => {
                    setSaved(true);
                    onSaved?.();
                  },
                },
              );
            }}
            disabled={update.isPending || (!dirty && !onSaved)}
          >
            {update.isPending ? 'Saving…' : submitLabel}
          </Button>
          {saved && !update.isPending ? (
            <p role="status" className="text-xs text-success-soft-fg">
              Saved
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
