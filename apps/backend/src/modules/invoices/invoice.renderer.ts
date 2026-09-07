import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * §14.2's invoice PDF, rendered.
 *
 * PURE. No database, no storage, no injection — `render(data)` in, bytes out.
 * That is what makes the layout unit-testable without a running app, and what
 * lets the SES attachment and the app download serve byte-identical documents.
 *
 * ⚠ `INR`, NOT `₹`, AND THIS IS NOT A STYLE CHOICE. pdf-lib's standard-14 fonts
 * use WinAnsiEncoding, which has no U+20B9 — passing a rupee sign throws
 * `WinAnsiEncoding cannot encode "₹"` at render time. The alternatives are
 * embedding a ~200 KB TTF plus `@pdf-lib/fontkit` for subsetting, or spelling
 * the currency. A tax invoice with a tofu box is worse than one that says INR,
 * so v1 says INR. Recorded here rather than discovered at the first render.
 *
 * ⚠ THIS IS A RECEIPT, NOT A COMPLIANT INDIAN TAX INVOICE. There is no platform
 * GSTIN, no HSN/SAC code, no place of supply and no invoice-number series.
 * `charge_config.tax_pct` is zero at launch so nothing is claimed today — but
 * the day somebody sets a rate, this document starts asserting a tax it is not
 * formatted to assert. See ToBeDoneEhsan.md.
 */

export interface InvoiceLine {
  label: string;
  amountPaise: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: Date;
  customerName: string | null;
  customerMobile: string | null;
  pickupAddress: string;
  dropAddress: string | null;
  serviceLabel: string;
  distanceKm: number | null;
  driverName: string | null;
  vehiclePlate: string | null;
  lines: InvoiceLine[];
  discountPaise: number;
  taxLabel: string;
  taxPct: number;
  taxPaise: number;
  totalPaise: number;
  paymentMethod: string | null;
  paidAt: Date | null;
}

const MARGIN = 56;
const PAGE = { width: 595.28, height: 841.89 } as const; // A4, points

export async function renderInvoice(data: InvoiceData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${data.invoiceNumber}`);
  pdf.setProducer('MiTow');
  pdf.setCreator('MiTow');

  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE.height - MARGIN;

  const text = (
    value: string,
    options: { font?: PDFFont; size?: number; x?: number; grey?: boolean; right?: boolean } = {},
  ): void => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, {
      x: options.right ? PAGE.width - MARGIN - width : (options.x ?? MARGIN),
      y,
      size,
      font,
      color: options.grey ? rgb(0.42, 0.45, 0.5) : rgb(0.09, 0.11, 0.13),
    });
  };

  const row = (label: string, value: string, options: { bold?: boolean } = {}): void => {
    text(label, { font: options.bold ? bold : regular });
    text(value, { font: options.bold ? bold : regular, right: true });
    y -= 18;
  };

  // ── Header ──────────────────────────────────────────────────────────────
  text('MiTow', { font: bold, size: 20 });
  text(data.invoiceNumber, { font: bold, size: 12, right: true });
  y -= 20;
  text('Roadside assistance and towing', { grey: true, size: 9 });
  text(`Issued ${formatDate(data.issuedAt)}`, { grey: true, size: 9, right: true });
  y -= 28;

  rule(page, y);
  y -= 24;

  // ── Parties ─────────────────────────────────────────────────────────────
  text('BILLED TO', { font: bold, size: 8, grey: true });
  y -= 14;
  text(data.customerName ?? 'Customer', { size: 11 });
  y -= 14;
  if (data.customerMobile) {
    text(data.customerMobile, { grey: true, size: 9 });
    y -= 14;
  }
  y -= 12;

  // ── Trip ────────────────────────────────────────────────────────────────
  text('TRIP', { font: bold, size: 8, grey: true });
  y -= 16;
  row('Service', data.serviceLabel);
  row('Pickup', truncate(data.pickupAddress, 46));
  if (data.dropAddress) row('Drop', truncate(data.dropAddress, 46));
  if (data.distanceKm !== null) row('Distance', `${data.distanceKm.toFixed(1)} km`);
  if (data.driverName) {
    row('Driver', data.vehiclePlate ? `${data.driverName} (${data.vehiclePlate})` : data.driverName);
  }
  y -= 12;

  rule(page, y);
  y -= 24;

  // ── Money ───────────────────────────────────────────────────────────────
  text('CHARGES', { font: bold, size: 8, grey: true });
  y -= 16;

  // Zero lines are OMITTED rather than printed as "INR 0.00": an invoice
  // listing four charges the customer did not incur reads as padding.
  for (const line of data.lines) {
    if (line.amountPaise !== 0) row(line.label, money(line.amountPaise));
  }

  if (data.discountPaise > 0) row('Discount', `- ${money(data.discountPaise)}`);

  // The tax line renders only when there IS tax. At the launch rate of zero the
  // document is a plain receipt, which is exactly what it should look like.
  if (data.taxPaise > 0) {
    row(`${data.taxLabel} (${data.taxPct}%)`, money(data.taxPaise));
  }

  y -= 6;
  rule(page, y);
  y -= 22;

  row('Total paid', money(data.totalPaise), { bold: true });
  y -= 6;

  if (data.paymentMethod) {
    text(
      data.paidAt
        ? `Paid by ${data.paymentMethod.toUpperCase()} on ${formatDate(data.paidAt)}`
        : `Paid by ${data.paymentMethod.toUpperCase()}`,
      { grey: true, size: 9 },
    );
    y -= 16;
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  page.drawText('This is a computer-generated receipt and needs no signature.', {
    x: MARGIN,
    y: MARGIN,
    size: 8,
    font: regular,
    color: rgb(0.55, 0.58, 0.62),
  });

  return Buffer.from(await pdf.save());
}

function rule(page: PDFPage, y: number): void {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE.width - MARGIN, y },
    thickness: 0.75,
    color: rgb(0.85, 0.87, 0.89),
  });
}

/** Indian grouping, and `INR` rather than the glyph — see the header. */
export function money(paise: number): string {
  const negative = paise < 0;
  const rupees = (Math.abs(paise) / 100).toFixed(2);
  const [whole = '0', fraction = '00'] = rupees.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}INR ${grouped}.${fraction}`;
}

function formatDate(at: Date): string {
  // IST, because the customer is in India and the server is not necessarily.
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  const day = String(ist.getUTCDate()).padStart(2, '0');
  const month = ist.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${month} ${ist.getUTCFullYear()}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
