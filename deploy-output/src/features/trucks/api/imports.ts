import {
  TRUCK_IMPORT_COLUMNS,
  truckImportRowSchema,
  type ImportRowErrorDto,
  type TruckImportDto,
} from '@towing/api-contracts';
import Papa from 'papaparse';
import { env } from '@/lib/env';

/**
 * Client-side CSV preview and pre-validation (§9.3.4).
 *
 * Validates with the SAME `truckImportRowSchema` the server uses, so the common
 * mistakes — wrong header, bad plate, non-numeric capacity — are shown next to
 * the file picker instead of after a round trip. This is a courtesy, never a
 * trust boundary: the server re-validates everything.
 */

export interface PreviewRow {
  row: number;
  plate: string;
  type: string;
  capacityTons: string;
  ok: boolean;
}

export interface ImportPreview {
  rows: PreviewRow[];
  errors: ImportRowErrorDto[];
  totalRows: number;
  validRows: number;
  fatal?: string;
}

/** How many rows the preview table renders; validation still covers them all. */
const PREVIEW_ROWS = 10;

export function previewCsv(text: string): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const missing = TRUCK_IMPORT_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [],
      totalRows: 0,
      validRows: 0,
      fatal: `Missing column(s): ${missing.join(', ')}. Expected header: ${TRUCK_IMPORT_COLUMNS.join(',')}`,
    };
  }

  const rows: PreviewRow[] = [];
  const errors: ImportRowErrorDto[] = [];
  let validRows = 0;

  for (const [index, raw] of parsed.data.entries()) {
    const rowNumber = index + 1;
    const candidate = truckImportRowSchema.safeParse({
      plate: raw.plate ?? '',
      type: raw.type?.trim(),
      capacityTons: raw.capacityTons?.trim(),
    });

    if (candidate.success) validRows += 1;
    else {
      for (const issue of candidate.error.issues) {
        errors.push({
          row: rowNumber,
          field: String(issue.path[0] ?? 'row'),
          code: 'validation_failed',
          message: issue.message,
        });
      }
    }

    if (rows.length < PREVIEW_ROWS) {
      rows.push({
        row: rowNumber,
        plate: raw.plate ?? '',
        type: raw.type ?? '',
        capacityTons: raw.capacityTons ?? '',
        ok: candidate.success,
      });
    }
  }

  return {
    rows,
    errors,
    totalRows: parsed.data.length,
    validRows,
    fatal: parsed.data.length === 0 ? 'The file has a header but no data rows' : undefined,
  };
}

/**
 * Uploads the file. Raw `fetch` rather than `apiFetch` because this is
 * multipart, matching the compliance-upload path.
 */
export async function uploadTruckCsv(file: File): Promise<TruckImportDto> {
  if (env.useMocks) return mockImportResult(file);

  const form = new FormData();
  form.set('file', file);

  const res = await fetch('/api/proxy/trucks/bulk', { method: 'POST', body: form });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ?? 'Import failed';
    throw new Error(message);
  }
  return body as TruckImportDto;
}

/** Mock mode reports what the client already validated — no network. */
async function mockImportResult(file: File): Promise<TruckImportDto> {
  const preview = previewCsv(await file.text());
  await new Promise((resolve) => setTimeout(resolve, 450));

  return {
    id: 'mock-import',
    filename: file.name,
    status: 'completed',
    totalRows: preview.totalRows,
    importedRows: preview.validRows,
    failedRows: preview.totalRows - preview.validRows,
    errors: preview.errors,
    failureReason: null,
    createdAt: new Date().toISOString(),
  };
}

/** Builds the `row,field,code,message` report client-side for mock mode. */
export function errorsToCsv(errors: ImportRowErrorDto[]): string {
  const escape = (value: string | number): string => {
    const text = String(value);
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  return [
    'row,field,code,message',
    ...errors.map((e) => [e.row, e.field, e.code, e.message].map(escape).join(',')),
  ].join('\r\n');
}
