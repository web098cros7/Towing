'use client';

import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerTitle,
  RelativeTime,
  Skeleton,
} from '@towing/web-ui';
import type { AdminPricingHistoryEntry } from '@towing/api-contracts';
import { useAdminPricingHistory } from '../api/adminPricing.queries';

/**
 * §9.4.8's "saved (versioned)". THE VERSION HISTORY IS THE AUDIT LOG — every
 * pricing write already stores the whole before and after in `admin_actions`,
 * so there is no second table to keep in step with it. This drawer is the read.
 */
export function PricingHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useAdminPricingHistory();

  return (
    <Drawer open={open} onClose={onClose} labelledBy="pricing-history-title">
      <DrawerHeader>
        <DrawerTitle id="pricing-history-title">Fare history</DrawerTitle>
        <p className="text-sm text-text-secondary">
          Who changed what, with the before and after as recorded.
        </p>
      </DrawerHeader>

      <DrawerBody>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ol className="space-y-3" data-testid="pricing-history-list">
            {(data ?? []).map((entry) => (
              <li
                key={entry.id}
                className="rounded-card border border-border p-3"
                data-testid="pricing-history-row"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{humanise(entry.action)}</span>
                  <RelativeTime at={entry.createdAt} className="text-xs text-text-tertiary" />
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {entry.reason ?? 'No reason given'}
                </p>
                <p className="mt-2 font-mono text-xs break-all text-text-tertiary">
                  {summarise(entry)}
                </p>
              </li>
            ))}
            {(data ?? []).length === 0 ? (
              <li className="text-sm text-text-secondary">No changes recorded yet.</li>
            ) : null}
          </ol>
        )}
      </DrawerBody>
    </Drawer>
  );
}

function humanise(action: string): string {
  if (action === 'pricing.rule.create') return 'Band added';
  if (action === 'pricing.rule.deactivate') return 'Band retired';
  if (action === 'pricing.update') return 'Fares or charges edited';
  return action;
}

/**
 * The before/after snapshots are whole config slices by design; rendering the
 * raw JSON would be a database dump. A rule-level change names its band, and a
 * charge change names the charge keys that moved.
 */
function summarise(entry: AdminPricingHistoryEntry): string {
  const parts: string[] = [];
  const before = entry.before as Record<string, unknown> | null;
  const after = entry.after as Record<string, unknown> | null;

  const describe = (value: Record<string, unknown> | null): string | null => {
    if (!value) return null;
    if (typeof value.ruleKind === 'string') {
      const band =
        value.maxKm !== null && value.maxKm !== undefined ? ` (up to ${value.maxKm} km)` : '';
      const price = typeof value.pricePaise === 'number' ? ` — ₹${value.pricePaise / 100}` : '';
      const active = value.isActive === false ? ' · retired' : '';
      return `${String(value.ruleKind)} · ${String(value.vehicleClass ?? value.serviceType ?? '')}${band}${price}${active}`;
    }
    if (value.charges && typeof value.charges === 'object') {
      return Object.keys(value.charges as Record<string, unknown>).join(', ');
    }
    return null;
  };

  const from = describe(before);
  const to = describe(after);
  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(to);
  else if (from) parts.push(`${from} → removed from the card`);

  return parts.join('') || 'Recorded';
}
