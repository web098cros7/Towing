'use client';

import { ArrowRight, X } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, Card, CardContent } from '@towing/web-ui';
import { ageSeconds, presenceFor, presenceLabel } from '../presence';
import type { FleetPosition } from '../types';

/**
 * §9.3.3 AC: "click marker → side panel (truck, driver, current job, ETA); panel
 * links to truck/driver/job detail."
 *
 * ETA is deliberately absent rather than guessed: it needs the Directions API
 * and the §11.5 smoothing engine, both scheduled for Track B (Phases 15–16). A
 * fabricated ETA is worse than none — §11.5 exists precisely because a
 * whiplashing estimate destroys trust.
 *
 * Follows the hand-rolled drawer pattern from `ComplianceDrawer`; `web-ui` has
 * no Drawer primitive.
 */

const statusVariant = {
  active: 'success',
  inactive: 'neutral',
  non_compliant: 'error',
} as const;

const statusLabel = {
  active: 'Active',
  inactive: 'Inactive',
  non_compliant: 'Non-compliant',
} as const;

const presenceVariant = { live: 'success', stale: 'warning', offline: 'neutral' } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function TruckSidePanel({
  position,
  nowMs,
  onClose,
}: {
  position: FleetPosition;
  nowMs: number;
  onClose: () => void;
}) {
  const presence = presenceFor(position.at ? Date.parse(position.at) : null, nowMs);
  const age = ageSeconds(position.at, nowMs);

  return (
    <aside
      data-testid="truck-side-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card p-6 shadow-xl"
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">{position.plate}</h2>
          <p className="text-sm text-text-secondary">
            {position.driverName ?? 'Unassigned'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant={statusVariant[position.status]}>{statusLabel[position.status]}</Badge>
        <Badge variant={presenceVariant[presence]}>{presenceLabel(presence)}</Badge>
        {position.activeBookingId ? <Badge variant="brand">On job</Badge> : null}
      </div>

      {position.status === 'non_compliant' ? (
        <Card className="mb-4 border-error-soft-bg bg-error-soft-bg/40">
          <CardContent className="p-3 text-sm text-error-soft-fg">
            This truck is excluded from dispatch until expired documents are renewed.
          </CardContent>
        </Card>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <Row label="Last ping">
          {age === null ? 'Never' : age < 2 ? 'Just now' : `${age}s ago`}
        </Row>
        <Row label="Speed">
          {position.speedKph === null ? '—' : `${Math.round(position.speedKph)} km/h`}
        </Row>
        <Row label="Heading">
          {position.heading === null ? '—' : `${Math.round(position.heading)}°`}
        </Row>
        <Row label="Position">
          {position.lat === null || position.lng === null
            ? 'Unknown'
            : `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`}
        </Row>
        {position.fromFallback ? (
          <Row label="Source">
            {/* Honesty: this position is the persisted one, up to ~10s behind. */}
            <span className="text-text-secondary">Last known (not live)</span>
          </Row>
        ) : null}
        {position.activeJobLeg ? (
          <Row label="Job leg">
            {/* Named honestly: the map draws a straight line, not a driven route. */}
            <span className="text-text-secondary">
              {position.activeJobLeg.drop ? 'Pickup → drop (direct)' : 'To pickup (direct)'}
            </span>
          </Row>
        ) : null}
        <Row label="ETA">
          <span className="text-text-tertiary">Available with route tracking</span>
        </Row>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4">
        <PanelLink href="/trucks" label="Truck details" />
        <PanelLink href="/drivers" label="Driver details" />
        <PanelLink
          href={position.activeBookingId ? '/jobs?status=assigned' : '/jobs'}
          label={position.activeBookingId ? 'Current job' : 'Job history'}
        />
      </div>
    </aside>
  );
}

function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-input px-2 py-2 text-sm transition-colors hover:bg-surface1"
    >
      <span className="flex-1">{label}</span>
      <ArrowRight className="size-4 text-text-tertiary" />
    </Link>
  );
}
