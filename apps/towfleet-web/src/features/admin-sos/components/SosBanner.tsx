'use client';

import Link from 'next/link';
import { RelativeTime } from '@towing/web-ui';
import { useAdminCan } from '@/components/admin/Can';
import { useOpenSosAlerts } from '../api/adminSos.queries';

/**
 * The persistent SOS banner (W14, §13) — it stays until the incident is
 * resolved, across every page in the console.
 *
 * DRIVEN BY DATA, NOT BY THE SOCKET. It reads the same open-alert query the
 * queue does, so it is correct after a reload, correct in mocks-on mode, and
 * correct when §19.2 has the console on REST polling — a socket-only banner
 * would be a console that looks calm during a gateway incident. The socket's
 * contribution is speed (an invalidation), not correctness.
 */
export function SosBanner(): React.ReactNode {
  const can = useAdminCan();
  const open = useOpenSosAlerts(can('sos.handle'));

  const items = open.data?.items ?? [];
  if (items.length === 0) return null;

  const first = items[0]!;
  const extra = items.length - 1;

  return (
    <Link
      href={`/admin/sos/${first.id}`}
      data-testid="admin-sos-banner"
      role="alert"
      className="flex items-center gap-3 border-b-2 border-sos bg-sos px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
    >
      <span aria-hidden className="inline-block size-2.5 animate-pulse rounded-full bg-white" />
      <span>
        SOS — {first.subjectName ?? 'Unknown subject'} ({first.subjectType})
      </span>
      <span className="font-normal opacity-90">
        raised <RelativeTime at={first.createdAt} />
      </span>
      {extra > 0 ? <span className="font-normal opacity-90">· +{extra} more open</span> : null}
      <span className="ml-auto font-normal opacity-90">Open the console →</span>
    </Link>
  );
}
