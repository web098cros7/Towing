import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ErrorCodes, rupeeStringToPaise, type InvoiceLinkDto } from '@towing/api-contracts';
import { ApiException } from '../../common/errors/api-exception';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { STORAGE, type StoragePort } from '../../common/storage/storage.port';
import { DB, type Database } from '../../db/db.module';
import { renderInvoice, type InvoiceData } from './invoice.renderer';

/** How long a download link lives. Long enough to tap, short enough to leak safely. */
const LINK_TTL_SECONDS = 300;

/**
 * §14.2's "invoice PDF generated", and §9.1.10's "invoices downloadable".
 *
 * GENERATION IS IDEMPOTENT ON `bookings.invoice_key`. A second call re-serves
 * the bytes that already exist rather than rendering a second, subtly different
 * document — the timestamp in the header alone would differ, and a customer
 * comparing the copy in their email to the one in the app must not find two.
 *
 * IT RUNS OFF THE HOT PATH, per §19.5 ("invoice generation … so the booking hot
 * path never blocks on a slow side effect") — `settleCapturedPayment` enqueues
 * `invoice.generate` and returns. With `QUEUE_ENABLED=false`, which is how the
 * entire test suite runs, `GET /invoice` calls `ensure()` synchronously instead,
 * so the path is exercised either way.
 */
@Injectable()
export class InvoiceService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  onModuleInit(): void {
    this.queue.process('invoice.generate', async (payload) => {
      await this.ensure(payload.bookingId);
    });
  }

  /**
   * Returns the storage key of this booking's invoice, rendering it if needed.
   *
   * The `invoice_key` check is the idempotency: two concurrent workers can both
   * render, but the second's UPDATE is guarded so only one key is ever
   * recorded, and the loser's bytes are simply orphaned in storage rather than
   * served.
   */
  async ensure(bookingId: string): Promise<string> {
    const [existing] = (await this.db.execute(sql`
      select invoice_key from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<{ invoice_key: string | null } | undefined>;

    if (!existing) throw ApiException.notFound('Booking not found');
    if (existing.invoice_key) return existing.invoice_key;

    const data = await this.data(bookingId);
    const buffer = await renderInvoice(data);

    const stored = await this.storage.put({
      buffer,
      mimeType: 'application/pdf',
      keyPrefix: `invoices/${bookingId}`,
    });

    // `local://<key>` or `s3://<key>` — the column holds the KEY, because
    // `presignGet` and `get` both take one and the scheme is the adapter's
    // business rather than the caller's.
    const key = stored.fileUrl.replace(/^[a-z0-9]+:\/\//, '');

    const [updated] = (await this.db.execute(sql`
      update bookings
         set invoice_key = ${key}, invoice_generated_at = now()
       where id = ${bookingId}::uuid and invoice_key is null
      returning invoice_key
    `)) as unknown as Array<{ invoice_key: string } | undefined>;

    // Lost the race: another worker recorded first. Serve THEIR key, so the
    // email attachment and the app download are the same bytes.
    if (!updated) {
      const [row] = (await this.db.execute(sql`
        select invoice_key from bookings where id = ${bookingId}::uuid
      `)) as unknown as [{ invoice_key: string }];
      return row.invoice_key;
    }

    this.logger.log(`invoice rendered for booking ${bookingId} (${buffer.byteLength} bytes)`);
    return key;
  }

  /** The bytes, for §12.2's email attachment. */
  async bytes(bookingId: string): Promise<Buffer> {
    return this.storage.get(await this.ensure(bookingId));
  }

  /**
   * The customer's download.
   *
   * A SIGNED URL IN JSON, NOT A 302. A redirect through `apiFetch` in React
   * Native is awkward to handle, and the app needs the URL itself to hand to
   * `Linking.openURL` — which is also what keeps the invoice download from
   * needing `expo-file-system` and therefore from adding a native module.
   */
  async link(bookingId: string, userId: string): Promise<InvoiceLinkDto> {
    const [row] = (await this.db.execute(sql`
      select user_id, status from bookings where id = ${bookingId}::uuid
    `)) as unknown as Array<{ user_id: string; status: string } | undefined>;

    // 404 rather than 403 — see every other customer-scoped read.
    if (!row || row.user_id !== userId) throw ApiException.notFound('Booking not found');

    if (row.status !== 'paid') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVOICE_NOT_READY,
        'An invoice is available once the trip is paid for',
        { status: row.status },
      );
    }

    const presigned = await this.storage.presignGet(await this.ensure(bookingId), LINK_TTL_SECONDS);
    return { url: presigned.url, expiresAt: presigned.expiresAt };
  }

  private async data(bookingId: string): Promise<InvoiceData> {
    const [row] = (await this.db.execute(sql`
      select b.id, b.created_at, b.paid_at, b.pickup_address, b.drop_address,
             b.service_type, b.distance_km,
             b.base_fare, b.distance_charge, b.night_charge, b.highway_charge,
             b.accident_charge, b.waiting_charge, b.surge_amount, b.discount,
             b.tax_pct, b.tax_amount, b.total, b.payment_method,
             b.contact_name, b.contact_mobile,
             u.name as customer_name, u.mobile as customer_mobile,
             d.name as driver_name,
             t.plate as plate,
             cc.tax_label
        from bookings b
        join users u on u.id = b.user_id
        left join drivers d on d.id = b.driver_id
        left join fleet_trucks t on t.id = b.truck_id
        left join charge_config cc on cc.singleton = true
       where b.id = ${bookingId}::uuid
    `)) as unknown as Array<Record<string, unknown> | undefined>;

    if (!row) throw ApiException.notFound('Booking not found');

    const paise = (value: unknown): number => rupeeStringToPaise((value as string | null) ?? '0');

    return {
      // Derived from the booking id, the same shape `EarningsService` uses for
      // a job code — so a customer quoting their invoice number and a fleet
      // owner quoting their job code are talking about the same trip.
      invoiceNumber: `INV-${bookingId.slice(0, 8).toUpperCase()}`,
      issuedAt: row.paid_at ? new Date(row.paid_at as string) : new Date(row.created_at as string),
      // §9.1.5's "booking for someone else": the invoice names the account
      // holder, because they are who paid.
      customerName: (row.customer_name as string | null) ?? null,
      customerMobile: (row.customer_mobile as string | null) ?? null,
      pickupAddress: (row.pickup_address as string | null) ?? '',
      dropAddress: (row.drop_address as string | null) ?? null,
      serviceLabel: serviceLabel(row.service_type as string),
      distanceKm: row.distance_km === null ? null : Number(row.distance_km),
      driverName: (row.driver_name as string | null) ?? null,
      vehiclePlate: (row.plate as string | null) ?? null,
      lines: [
        { label: 'Base fare', amountPaise: paise(row.base_fare) },
        { label: 'Distance', amountPaise: paise(row.distance_charge) },
        { label: 'Night charge', amountPaise: paise(row.night_charge) },
        { label: 'Highway pickup', amountPaise: paise(row.highway_charge) },
        { label: 'Accident recovery', amountPaise: paise(row.accident_charge) },
        { label: 'Waiting', amountPaise: paise(row.waiting_charge) },
        { label: 'Surge', amountPaise: paise(row.surge_amount) },
      ],
      discountPaise: paise(row.discount),
      taxLabel: (row.tax_label as string | null) ?? 'GST',
      taxPct: Number((row.tax_pct as string | null) ?? '0'),
      taxPaise: paise(row.tax_amount),
      totalPaise: paise(row.total),
      paymentMethod: (row.payment_method as string | null) ?? null,
      paidAt: row.paid_at ? new Date(row.paid_at as string) : null,
    };
  }
}

function serviceLabel(serviceType: string): string {
  return serviceType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
