'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  FilterBar,
  KpiCard,
  RelativeTime,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@towing/web-ui';
import type {
  AdminNotificationDelivery,
  AdminNotificationTestSend,
  NotificationChannel,
} from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useNotificationDeliveries,
  useNotificationTemplates,
  useNotificationTestSend,
} from '../api/adminNotifications.queries';

type NotificationDeliveryStatus = AdminNotificationDelivery['status'];
type NotificationTestChannel = AdminNotificationTestSend['channel'];

const STATUS_TONE: Record<NotificationDeliveryStatus, 'neutral' | 'info' | 'success' | 'error'> = {
  queued: 'neutral',
  sending: 'info',
  sent: 'success',
  failed: 'error',
  skipped: 'neutral',
};

const deliveryColumns: ColumnDef<AdminNotificationDelivery, unknown>[] = [
  {
    accessorKey: 'event',
    header: 'Event',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.event}</span>,
  },
  {
    accessorKey: 'channel',
    header: 'Channel',
    cell: ({ row }) => <Badge variant="neutral">{row.original.channel}</Badge>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip status={row.original.status} tone={STATUS_TONE[row.original.status]} />
    ),
  },
  {
    id: 'destination',
    header: 'Destination',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.destination ?? '—'}</span>,
  },
  {
    id: 'attempts',
    header: 'Tries',
    cell: ({ row }) => <span className="tabular-nums">{row.original.attempts}</span>,
  },
  {
    id: 'error',
    header: 'Last error',
    cell: ({ row }) =>
      row.original.lastError ? (
        <span className="text-xs text-error-soft-fg">{row.original.lastError}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    id: 'when',
    header: 'When',
    cell: ({ row }) => (
      <RelativeTime at={row.original.sentAt ?? row.original.createdAt} className="text-xs" />
    ),
  },
];

/**
 * `/admin/settings/notifications` — W18 (§12.3).
 *
 * Templates are a VIEWER: the catalogue is DLT/Meta-approved content and an
 * editor here would desynchronise what is sent from what was approved (the
 * catalogue file's own argument, restated on the tab). The screen's most
 * useful fact is the red "cannot send" chip on rows whose provider template id
 * is null.
 *
 * The delivery log renders destinations AS STORED — already masked, because
 * the raw address never reached the table.
 *
 * The test-send is super-admin only (`admin.manage`); everybody else who can
 * open this page sees the control disabled with the reason next to it, which
 * is the same honest-refusal pattern the rest of the console uses.
 */
export function NotificationsPanel() {
  const [tab, setTab] = useState<'templates' | 'deliveries' | 'test'>('templates');

  return (
    <div>
      <Tabs
        items={[
          { value: 'templates', label: 'Templates' },
          { value: 'deliveries', label: 'Deliveries' },
          { value: 'test', label: 'Test send' },
        ]}
        value={tab}
        onChange={setTab}
        aria-label="Notification sections"
      />

      <div className="mt-4">
        {tab === 'templates' ? (
          <TemplatesTab />
        ) : tab === 'deliveries' ? (
          <DeliveriesTab />
        ) : (
          <TestSendTab />
        )}
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { data, isLoading, isError, refetch } = useNotificationTemplates();

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-error-soft-fg">Could not load the template catalogue.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Read-only by design: SMS bodies are DLT-registered and WhatsApp bodies are Meta-approved by
        template id — editing them here would desynchronise what we send from what was approved.
      </p>

      <div className="rounded-card border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Can send</TableHead>
              <TableHead>Variables</TableHead>
              <TableHead>Sample</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((template) => (
              <TableRow key={template.templateKey} data-testid="template-row">
                <TableCell className="font-mono text-xs">{template.templateKey}</TableCell>
                <TableCell className="font-mono text-xs">{template.event ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {template.channels.map((channel) => (
                      <Badge key={channel} variant="neutral">
                        {channel}
                      </Badge>
                    ))}
                    {template.channels.length === 0 ? (
                      <span className="text-text-tertiary">—</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  {template.unusableChannels.length === 0 ? (
                    <span className="text-xs text-success-soft-fg">all channels</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {template.unusableChannels.map((channel) => (
                        <span
                          key={channel}
                          data-testid={`unusable-${channel}`}
                          className="rounded-full bg-error-soft-bg px-2 py-0.5 text-xs font-semibold text-error-soft-fg"
                        >
                          {channel}: template id missing
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {template.orderedVariables.join(', ') || '—'}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer text-xs text-brand">View</summary>
                    <div className="mt-1 space-y-1 text-xs">
                      {template.sampleSubject ? (
                        <div className="font-semibold">{template.sampleSubject}</div>
                      ) : null}
                      <div>{template.sampleBody}</div>
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DeliveriesTab() {
  const [status, setStatus] = useState<'' | NotificationDeliveryStatus>('');
  const [channel, setChannel] = useState<'' | NotificationChannel>('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading, isError, refetch } = useNotificationDeliveries({
    page,
    limit,
    ...(status === '' ? {} : { status }),
    ...(channel === '' ? {} : { channel }),
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Dead-letter depth"
          value={data ? String(data.deadLetterDepth) : '—'}
          hint="jobs out of attempts"
        />
      </div>

      <FilterBar>
        <Select
          className="w-40"
          value={status}
          data-testid="deliveries-status"
          aria-label="Delivery status"
          onChange={(event) => {
            setStatus(event.target.value as '' | NotificationDeliveryStatus);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </Select>
        <Select
          className="w-40"
          value={channel}
          data-testid="deliveries-channel"
          aria-label="Delivery channel"
          onChange={(event) => {
            setChannel(event.target.value as '' | NotificationChannel);
            setPage(1);
          }}
        >
          <option value="">All channels</option>
          <option value="push">Push</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={deliveryColumns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No deliveries match"
        emptyDescription="Adjust the filters."
        pagination={{ page, pageCount, onPageChange: setPage }}
      />
    </div>
  );
}

function TestSendTab() {
  const can = useAdminCan();
  const toast = useToast();
  const templates = useNotificationTemplates();
  const testSend = useNotificationTestSend();

  const options = templates.data?.items ?? [];
  const [templateKey, setTemplateKey] = useState('');
  const [channel, setChannel] = useState<NotificationTestChannel>('sms');

  const selected = templateKey || options[0]?.templateKey || '';
  const allowed = can('admin.manage');

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-text-secondary">
        Sends ONE message to YOUR OWN admin contact — there is no destination field, on purpose. The
        send is audited and rate-limited.
      </p>

      <div className="space-y-1">
        <label className="text-sm font-semibold" htmlFor="test-template">
          Template
        </label>
        <Select
          id="test-template"
          data-testid="test-template"
          value={selected}
          onChange={(event) => setTemplateKey(event.target.value)}
        >
          {options.map((template) => (
            <option key={template.templateKey} value={template.templateKey}>
              {template.templateKey}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-semibold" htmlFor="test-channel">
          Channel
        </label>
        <Select
          id="test-channel"
          data-testid="test-channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as NotificationTestChannel)}
        >
          <option value="sms">SMS (my mobile)</option>
          <option value="email">Email (my address)</option>
          <option value="whatsapp">WhatsApp (my mobile)</option>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Button
          data-testid="test-send"
          disabled={!allowed || testSend.isPending || selected === ''}
          onClick={() =>
            testSend.mutate(
              { channel, templateKey: selected },
              {
                onSuccess: (result) =>
                  toast(
                    result.sent
                      ? `Test sent to ${result.destination}`
                      : `Refused by the provider: ${result.code ?? 'unknown'}`,
                    result.sent ? 'success' : 'error',
                  ),
                onError: (error) => toast((error as Error).message, 'error'),
              },
            )
          }
        >
          {testSend.isPending ? 'Sending…' : 'Send test to me'}
        </Button>
        {allowed ? null : (
          <span className="text-xs text-text-secondary" data-testid="test-send-guard">
            Super admin only.
          </span>
        )}
      </div>

      {testSend.data ? (
        <div
          data-testid="test-send-result"
          className={
            'rounded-card border p-3 text-sm ' +
            (testSend.data.sent
              ? 'border-border text-text-primary'
              : 'border-error-soft-fg/40 text-error-soft-fg')
          }
        >
          {testSend.data.sent
            ? `Sent to ${testSend.data.destination}.`
            : `Not sent: ${testSend.data.code ?? 'unknown reason'} (${testSend.data.destination}).`}
        </div>
      ) : null}
    </div>
  );
}
