'use client';

import { useState } from 'react';
import type { AdminQuote, AdminQuotesQuery, QuoteStatus } from '@towing/api-contracts';
import {
  Button,
  Card,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
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
} from '@towing/web-ui';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useAdminQuote,
  useAdminQuotes,
  useQuoteExpire,
  useQuotePrice,
  useQuoteReject,
} from '../api/adminQuotes.queries';

const STATUS_TONE: Record<QuoteStatus, 'neutral' | 'info' | 'success' | 'error' | 'warning'> = {
  requested: 'info',
  quoted: 'warning',
  accepted: 'success',
  rejected: 'neutral',
  expired: 'neutral',
};

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

/**
 * W20's manual-quote queue (§7.3), `/admin/quotes`.
 *
 * THE OPERATOR TYPES ONE NUMBER, IN RUPEES, AND THE SCREEN SHOWS IT BACK IN
 * RUPEES. The API takes paise (the house money vocabulary), but the person on
 * the phone thinks in "eighty-five thousand", and a form that made them type
 * 8500000 would be a form that gets a zero wrong. Conversion happens at the
 * boundary, once, and the preview line shows the total the customer will see.
 *
 * A quoted row is NOT editable in place by accident: re-quoting is allowed
 * (an operator's typo must be fixable before the customer answers) but the
 * drawer shows the current offer above the form, so nobody re-prices blind.
 */
export function QuotesPanel() {
  const [status, setStatus] = useState<'' | QuoteStatus>('');
  const [openId, setOpenId] = useState<string | null>(null);

  const query: AdminQuotesQuery = {
    page: 1,
    limit: 25,
    ...(status ? { status } : {}),
  };
  const quotes = useAdminQuotes(query);

  return (
    <div className="space-y-4" data-testid="quotes-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm font-semibold">
          <span>Status</span>
          <Select
            data-testid="quotes-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | QuoteStatus)}
          >
            <option value="">All</option>
            <option value="requested">Requested</option>
            <option value="quoted">Quoted</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </Select>
        </label>
      </div>

      {quotes.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : quotes.data && quotes.data.items.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.data.items.map((quote) => (
                <TableRow key={quote.id} data-testid="quote-row">
                  <TableCell>
                    <span className="font-medium">{quote.userLabel ?? 'Customer'}</span>
                  </TableCell>
                  <TableCell className="max-w-[18rem] text-sm">
                    <div className="truncate">{quote.pickupAddress ?? 'Pickup'}</div>
                    <div className="truncate text-text-secondary">
                      → {quote.dropAddress ?? 'Drop'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{quote.distanceKm.toFixed(0)} km</TableCell>
                  <TableCell>
                    <StatusChip
                      status={quote.status}
                      tone={STATUS_TONE[quote.status]}
                      data-testid="quote-status"
                    />
                  </TableCell>
                  <TableCell className="text-sm">
                    {quote.totalPaise === null ? (
                      '—'
                    ) : (
                      <span data-testid="quote-total">{rupees(quote.totalPaise)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    <RelativeTime at={quote.requestedAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="secondary"
                      data-testid="quote-open"
                      onClick={() => setOpenId(quote.id)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-text-secondary" data-testid="quotes-empty">
          No quote requests match.
        </Card>
      )}

      <QuoteDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function QuoteDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const detail = useAdminQuote(id);
  const price = useQuotePrice();
  const reject = useQuoteReject();
  const expire = useQuoteExpire();

  const [rupeeInput, setRupeeInput] = useState('');
  const [note, setNote] = useState('');
  const [validHours, setValidHours] = useState(48);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const quote = detail.data ?? null;
  const actionable = quote !== null && ['requested', 'quoted'].includes(quote.status);

  const close = () => {
    setRupeeInput('');
    setNote('');
    setRejectReason('');
    setError(null);
    onClose();
  };

  const totalPaise = parseRupeesToPaise(rupeeInput);
  const canQuote = totalPaise !== null && totalPaise >= 100 && !price.isPending;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
      toast(message, 'success');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The action failed.');
    }
  };

  return (
    <Drawer open={id !== null} onClose={close} labelledBy="quote-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="quote-drawer-title">Manual quote</DrawerTitle>
      </DrawerHeader>
      <DrawerBody className="space-y-4">
        {!quote ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-text-secondary">Customer</dt>
                <dd data-testid="drawer-customer">{quote.userLabel ?? 'Customer'}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Status</dt>
                <dd>
                  <StatusChip status={quote.status} tone={STATUS_TONE[quote.status]} />
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Distance</dt>
                <dd>{quote.distanceKm.toFixed(1)} km</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Service</dt>
                <dd>{quote.serviceSlug}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-text-secondary">Route</dt>
                <dd>
                  {quote.pickupAddress ?? 'Pickup'} → {quote.dropAddress ?? 'Drop'}
                </dd>
              </div>
              {quote.notes ? (
                <div className="col-span-2">
                  <dt className="text-text-secondary">Customer notes</dt>
                  <dd data-testid="drawer-notes">{quote.notes}</dd>
                </div>
              ) : null}
            </dl>

            {quote.totalPaise !== null ? (
              <div
                className="rounded-card border border-border p-3 text-sm"
                data-testid="drawer-quoted"
              >
                <div className="font-semibold">{rupees(quote.totalPaise)}</div>
                {quote.quoteNote ? <div className="text-text-secondary">{quote.quoteNote}</div> : null}
                {quote.validUntil ? (
                  <div className="text-xs text-text-secondary" data-testid="drawer-valid-until">
                    Valid until {new Date(quote.validUntil).toLocaleString('en-IN')}
                  </div>
                ) : null}
                {quote.bookingId ? (
                  <div className="text-xs text-text-secondary" data-testid="drawer-booking">
                    Booked as {quote.bookingId.slice(0, 8)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {quote.rejectionReason ? (
              <div className="text-sm text-text-secondary" data-testid="drawer-rejection">
                Rejected: {quote.rejectionReason}
              </div>
            ) : null}

            {actionable ? (
              <section className="space-y-3" data-testid="drawer-actions">
                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="price-rupees">
                    Total (₹)
                  </label>
                  <input
                    id="price-rupees"
                    data-testid="price-rupees"
                    inputMode="numeric"
                    className="w-full rounded-card border border-border bg-surface px-3 py-2 text-sm"
                    value={rupeeInput}
                    onChange={(event) => setRupeeInput(event.target.value)}
                    placeholder="85000"
                  />
                  {totalPaise === null && rupeeInput.trim() !== '' ? (
                    <p className="text-xs text-error" data-testid="price-error">
                      A whole number of rupees.
                    </p>
                  ) : null}
                  {totalPaise !== null ? (
                    <p className="text-xs text-text-secondary" data-testid="price-preview">
                      Customer sees {rupees(totalPaise)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="price-note">
                    Memo (shown with the offer)
                  </label>
                  <input
                    id="price-note"
                    data-testid="price-note"
                    className="w-full rounded-card border border-border bg-surface px-3 py-2 text-sm"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="price-validity">
                    Valid for
                  </label>
                  <Select
                    id="price-validity"
                    data-testid="price-validity"
                    value={String(validHours)}
                    onChange={(event) => setValidHours(Number(event.target.value))}
                  >
                    <option value="24">24 hours</option>
                    <option value="48">48 hours</option>
                    <option value="168">1 week</option>
                  </Select>
                </div>

                <Button
                  data-testid="quote-submit"
                  disabled={!canQuote}
                  onClick={() =>
                    void run(
                      () =>
                        price.mutateAsync({
                          id: quote.id,
                          body: {
                            totalPaise: totalPaise!,
                            ...(note.trim() ? { note: note.trim() } : {}),
                            validHours,
                          },
                        }),
                      'Quote sent to the customer.',
                    )
                  }
                >
                  {quote.status === 'quoted' ? 'Re-quote' : 'Send quote'}
                </Button>

                <div className="space-y-1 border-t border-border pt-3">
                  <label className="text-sm font-semibold" htmlFor="reject-reason">
                    Or reject with a reason
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="reject-reason"
                      data-testid="reject-reason"
                      className="w-full rounded-card border border-border bg-surface px-3 py-2 text-sm"
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                    />
                    <Button
                      variant="secondary"
                      data-testid="reject-submit"
                      disabled={rejectReason.trim().length < 3}
                      onClick={() =>
                        void run(
                          () =>
                            reject.mutateAsync({
                              id: quote.id,
                              body: { reason: rejectReason.trim() },
                            }),
                          'Request rejected.',
                        )
                      }
                    >
                      Reject
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    data-testid="expire-submit"
                    onClick={() => void run(() => expire.mutateAsync(quote.id), 'Marked expired.')}
                  >
                    Mark expired
                  </Button>
                </div>

                {error ? (
                  <p className="text-sm text-error" data-testid="quote-error">
                    {error}
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

/**
 * Rupees input → paise, or null when the input is not a whole number of
 * rupees. Deliberately refuses decimals: the API takes integer paise and the
 * operator's figure is always a round rupee amount in practice, so silently
 * rounding a typo ("85000.50") would be worse than refusing it.
 */
function parseRupeesToPaise(value: string): number | null {
  const trimmed = value.replaceAll(',', '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const rupeesValue = Number(trimmed);
  if (!Number.isSafeInteger(rupeesValue)) return null;
  return rupeesValue * 100;
}
