'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  DateRangePicker,
  FilterBar,
  Input,
  RelativeTime,
  SearchInput,
  Select,
  type ColumnDef,
  type DateRange,
} from '@towing/web-ui';
import type { AdminAuditEntry, AdminAuditQuery } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { useAdminAuditFeed } from '@/features/admin-audit/api/adminAudit.queries';
import { AuditEntryDrawer } from '@/features/admin-audit/components/AuditEntryDrawer';

/**
 * The audit viewer (§3.5, §20.4).
 *
 * WHAT IT SHOWS: every admin action newest-first, filtered by actor-agnostic
 * criteria the API supports. What it deliberately does NOT show is a total —
 * a cursor feed has no count, and inventing one would cost a full scan per
 * keystroke.
 *
 * The date inputs are CALENDAR DAYS expanded to UTC instants here; the feed
 * compares instants directly. (The ops dashboard's IST day boundaries are a
 * metrics concern, not an audit one — an audit answer must not shift by a
 * timezone bug.)
 */
const SUBJECT_TYPES = ['', 'driver', 'user', 'fleet', 'booking', 'payout', 'admin', 'pricing'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [subjectType, setSubjectType] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const subjectIdTrimmed = subjectId.trim();
  const subjectIdInvalid = subjectIdTrimmed.length > 0 && !UUID_PATTERN.test(subjectIdTrimmed);

  const query: AdminAuditQuery = useMemo(
    () => ({
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(subjectType ? { subjectType } : {}),
      // An invalid uuid is dropped rather than sent to earn a 422 — the inline
      // hint below says why, so it is not a silent ignore.
      ...(subjectIdTrimmed && UUID_PATTERN.test(subjectIdTrimmed)
        ? { subjectId: subjectIdTrimmed }
        : {}),
      ...(range.from ? { from: `${range.from}T00:00:00.000Z` } : {}),
      ...(range.to ? { to: `${range.to}T23:59:59.999Z` } : {}),
    }),
    [action, subjectType, subjectIdTrimmed, range],
  );

  const feed = useAdminAuditFeed(query);
  const entries = useMemo(
    () => feed.data?.pages.flatMap((page) => page.entries) ?? [],
    [feed.data],
  );

  const hasFilters =
    action.trim() !== '' ||
    subjectType !== '' ||
    subjectIdTrimmed !== '' ||
    range.from !== null ||
    range.to !== null;

  const columns: ColumnDef<AdminAuditEntry, unknown>[] = [
    {
      id: 'when',
      header: 'When',
      cell: ({ row }) => <RelativeTime at={row.original.createdAt} className="text-xs" />,
    },
    {
      id: 'action',
      header: 'Action',
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium">{row.original.action}</span>
      ),
    },
    {
      id: 'subject',
      header: 'Subject',
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.subjectType}
          {row.original.subjectId ? (
            <span className="ml-1 font-mono text-text-tertiary">
              {row.original.subjectId.slice(0, 8)}…
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.original.adminId.slice(0, 8)}…
        </span>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: ({ row }) => (
        <span className="block max-w-[18rem] truncate text-xs text-text-secondary">
          {row.original.reason ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit"
        description="Every admin action, newest first — refusals are recorded here too."
      />

      <FilterBar>
        <SearchInput
          value={action}
          onValueChange={setAction}
          placeholder="Action prefix, e.g. driver.kyc"
          aria-label="Filter by action prefix"
          data-testid="audit-action-filter"
          className="w-64"
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Subject type
          </span>
          <Select
            value={subjectType}
            onChange={(event) => setSubjectType(event.target.value)}
            aria-label="Subject type"
            data-testid="audit-subject-type"
            className="w-40"
          >
            {SUBJECT_TYPES.map((type) => (
              <option key={type || 'all'} value={type}>
                {type === '' ? 'All subjects' : type}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex w-60 flex-col gap-1">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Subject id
          </span>
          <Input
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            placeholder="UUID"
            aria-label="Subject id"
            data-testid="audit-subject-id"
            aria-invalid={subjectIdInvalid ? true : undefined}
          />
          {subjectIdInvalid ? (
            <span className="text-xs text-error">Not a UUID — ignored while it stays invalid</span>
          ) : null}
        </label>
        <DateRangePicker value={range} onChange={setRange} />
        {hasFilters ? (
          <Button
            variant="outline"
            onClick={() => {
              setAction('');
              setSubjectType('');
              setSubjectId('');
              setRange({ from: null, to: null });
            }}
          >
            Clear
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        data={entries}
        isLoading={feed.isLoading}
        isError={feed.isError}
        onRetry={() => void feed.refetch()}
        onRowClick={(entry) => setSelectedId(entry.id)}
        emptyTitle="No audit entries"
        emptyDescription="Nothing matches these filters. Widen the window or clear the action prefix."
      />

      {feed.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            data-testid="audit-load-more"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <AuditEntryDrawer entryId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
