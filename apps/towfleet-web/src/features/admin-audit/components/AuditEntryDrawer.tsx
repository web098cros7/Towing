'use client';

import { AlertCircle, Clock, Globe, User } from 'lucide-react';
import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerTitle,
  JsonDiff,
  RelativeTime,
  Skeleton,
} from '@towing/web-ui';
import { ErrorState } from '@towing/web-ui';
import { useAdminAuditDetail } from '../api/adminAudit.queries';

/**
 * One audit row in full (W1 §3.5): metadata, the reason, and the before/after
 * diff. Loads by id — NOT from the row the table already holds — because the
 * feed's list projection deliberately omits before/after (a 50-row JSON dump is
 * not a list), and because the drawer must be safe to open on a stale row.
 */
export function AuditEntryDrawer({
  entryId,
  onClose,
}: {
  entryId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useAdminAuditDetail(entryId);

  return (
    <Drawer open={entryId !== null} onClose={onClose} labelledBy="audit-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="audit-drawer-title">Audit entry</DrawerTitle>
        {data ? (
          <p className="font-mono text-xs text-text-secondary" data-testid="audit-detail-action">
            {data.action}
          </p>
        ) : null}
      </DrawerHeader>

      <DrawerBody>
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail icon={<User className="size-3.5" />} label="Actor">
                <span className="font-mono text-xs">{data.adminId.slice(0, 8)}…</span>
              </Detail>
              <Detail icon={<Clock className="size-3.5" />} label="When">
                <RelativeTime at={data.createdAt} />
              </Detail>
              <Detail icon={<AlertCircle className="size-3.5" />} label="Subject">
                <span className="text-xs">
                  {data.subjectType}
                  {data.subjectId ? ` · ${data.subjectId.slice(0, 8)}…` : ''}
                </span>
              </Detail>
              <Detail icon={<Globe className="size-3.5" />} label="Source">
                <span className="font-mono text-xs">{data.ip ?? '—'}</span>
                <span
                  className="block truncate text-xs text-text-tertiary"
                  title={data.userAgent ?? undefined}
                >
                  {data.userAgent ?? ''}
                </span>
              </Detail>
            </dl>

            {data.reason ? (
              <div>
                <div className="mb-1 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Reason
                </div>
                <p className="rounded-input bg-surface1 p-3 text-sm">{data.reason}</p>
              </div>
            ) : null}

            <div>
              <div className="mb-1 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Change
              </div>
              <JsonDiff before={data.before} after={data.after} />
            </div>
          </>
        )}
      </DrawerBody>
    </Drawer>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
