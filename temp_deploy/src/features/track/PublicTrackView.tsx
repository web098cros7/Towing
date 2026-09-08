'use client';

import { useEffect, useMemo, useState } from 'react';
import { decodePolyline, type PublicTrack } from '@towing/api-contracts';
import { presenceFor } from '@/features/realtime/presence';
import { TrackMap } from './TrackMap';

/**
 * §11.7's public page: "live truck position, pickup area, ETA, driver first name
 * + vehicle plate, trip status — no phone numbers, no exact customer address".
 *
 * FED BY A TEN-SECOND POLL, NOT BY THE SOCKET, and this is the phase's one
 * deliberate deviation from the specification. §11.7 asks for a
 * `track:{shareToken}` pub/sub channel. Two things argued against it:
 *
 *  · Every socket in this system is authenticated by a single-use ticket minted
 *    after an ownership check. A share-token room has no owner to check — the
 *    whole point is that a stranger holds the link — so it would be the first
 *    unauthenticated socket surface in the product, with a connection budget and
 *    a room namespace reachable by anyone ever forwarded a link.
 *  · A poll is not a downgrade in kind. It is the §19.2 rung the customer's own
 *    app falls back to, and this page's job is to show a truck moving on a map:
 *    ten seconds is inside the window the marker animation already spans.
 *
 * Recorded here and in `realtime/customer-events.ts`, at both seams it touches.
 *
 * WHAT THIS PAGE MUST NEVER GROW. It renders `PublicTrack` and nothing else. The
 * projection is a hand-written allowlist on the server (`publicTrackSchema`) with
 * a test asserting its exact key list, and the reason it is an allowlist rather
 * than a redaction is that a page like this is where a leaked field ends up.
 */

const POLL_MS = 10_000;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; track: PublicTrack }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

export function PublicTrackView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/track/${token}`, { cache: 'no-store' });

        if (cancelled) return;

        if (response.status === 410) {
          setState({ kind: 'expired' });
          return;
        }
        if (response.status === 404 || response.status === 422) {
          setState({ kind: 'missing' });
          return;
        }
        if (!response.ok) {
          // Keep whatever we last had rather than blanking the page on one bad
          // poll — a viewer watching a truck should not lose it to a blip.
          setState((previous) => (previous.kind === 'ok' ? previous : { kind: 'unreachable' }));
          return;
        }

        setState({ kind: 'ok', track: (await response.json()) as PublicTrack });
      } catch {
        if (!cancelled) {
          setState((previous) => (previous.kind === 'ok' ? previous : { kind: 'unreachable' }));
        }
      }
    }

    void load();
    const poll = setInterval(load, POLL_MS);
    // A second, faster clock for the age-derived staleness label. §11.6's whole
    // point is the ABSENCE of data, so the freshness has to be recomputed even
    // when no poll returns anything new.
    const tick = setInterval(() => setNow(Date.now()), 1_000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [token]);

  const track = state.kind === 'ok' ? state.track : null;

  /**
   * §11.6's thresholds, from the shared contract — never redefined here. The
   * customer's app, the fleet console and this page all decide "stale" at the
   * same age, or none of them means anything.
   */
  const presence = useMemo(() => {
    if (!track?.position) return 'offline' as const;
    return presenceFor(Date.parse(track.position.at), now);
  }, [track?.position, now]);

  const routePoints = useMemo(() => {
    if (!track?.routePolyline) return [];
    return decodePolyline(track.routePolyline);
  }, [track?.routePolyline]);

  if (state.kind === 'loading') {
    return <Shell><p className="text-sm text-muted-foreground">Loading this trip…</p></Shell>;
  }

  if (state.kind === 'missing') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">
          Check that you have the whole link, or ask for a new one.
        </p>
      </Shell>
    );
  }

  if (state.kind === 'expired') {
    return (
      <Shell>
        {/*
          Deliberately calmer than an error. Somebody was sent this because a
          person they care about was in trouble; "this trip has ended" is the
          answer they want, and a 404's "not found" would read as something
          having gone wrong.
        */}
        <h1 className="text-lg font-semibold">This trip has ended</h1>
        <p className="text-sm text-muted-foreground">
          The live link is no longer available.
        </p>
      </Shell>
    );
  }

  if (state.kind === 'unreachable' || !track) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">We can’t reach this trip right now</h1>
        <p className="text-sm text-muted-foreground">Trying again in a moment…</p>
      </Shell>
    );
  }

  const etaMinutes = track.etaSeconds === null ? null : Math.max(1, Math.round(track.etaSeconds / 60));

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Live tow</h1>
        <span className="text-xs text-muted-foreground">{STATUS_COPY[track.status] ?? track.status}</span>
      </header>

      <TrackMap
        position={track.position}
        pickupArea={track.pickupArea}
        route={routePoints}
        ghost={presence !== 'live'}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Driver</dt>
            <dd className="font-medium">{track.driverFirstName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Vehicle</dt>
            <dd className="font-medium">{track.vehiclePlate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Arriving in</dt>
            <dd className="font-medium">{etaMinutes === null ? '—' : `${etaMinutes} min`}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Position</dt>
            <dd className="font-medium">
              {presence === 'live' ? 'Live' : presence === 'stale' ? 'Reconnecting…' : 'Last known'}
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-xs text-muted-foreground">
        {/*
          Says out loud that the position is approximate. A viewer who walked to
          the dot and found nobody would reasonably conclude the page was broken,
          when in fact it is doing exactly what §11.7 asks of it.
        */}
        Positions are approximate. This page shows only the driver’s first name, the vehicle plate
        and a rough location — no phone numbers and no addresses.
      </p>
    </main>
  );
}

/** §5.1's statuses, in the words a stranger to the app would use. */
const STATUS_COPY: Partial<Record<PublicTrack['status'], string>> = {
  searching: 'Finding a driver',
  assigned: 'Driver assigned',
  en_route: 'On the way',
  arrived: 'At the pickup',
  in_progress: 'Towing',
  completed: 'Completed',
  paid: 'Completed',
  cancelled: 'Cancelled',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 p-8 text-center">
      {children}
    </main>
  );
}
