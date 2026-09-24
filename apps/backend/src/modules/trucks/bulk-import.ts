import {
  IMPORT_ERROR_REPORT_CAP,
  TRUCK_IMPORT_COLUMNS,
  TRUCK_IMPORT_OPTIONAL_COLUMNS,
  importErrorCodes,
  truckImportRowSchema,
  type ImportRowErrorDto,
  type TruckImportRow,
} from '@towing/api-contracts';
import Papa from 'papaparse';

/**
 * CSV parsing and validation for the bulk truck import (§9.3.4).
 *
 * Pure: no database, no Nest. The request path and the queued worker both run
 * exactly this, so "what counts as a valid row" cannot differ between a 400-row
 * upload and a 4,000-row one.
 */

export interface ParsedImport {
  valid: Array<{ row: number; data: TruckImportRow }>;
  errors: ImportRowErrorDto[];
  /** Data rows seen, header excluded — including the ones that failed. */
  totalRows: number;
  /** Set when the file is unusable as a whole (bad header, no rows, too big). */
  fatal?: string;
}

function pushError(errors: ImportRowErrorDto[], error: ImportRowErrorDto): void {
  // The report is capped: a 10k-row disaster must not become a 10k-entry JSON
  // blob in the row store and in the response. The counts stay exact.
  if (errors.length < IMPORT_ERROR_REPORT_CAP) errors.push(error);
}

export function parseTruckCsv(csv: string, maxRows: number): ParsedImport {
  const result: ParsedImport = { valid: [], errors: [], totalRows: 0 };

  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const missing = TRUCK_IMPORT_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    // Fatal rather than per-row: every row would fail identically, and 4,000
    // copies of "plate is required" hides the actual problem.
    result.fatal = `Missing required column(s): ${missing.join(', ')}. Expected header: ${TRUCK_IMPORT_COLUMNS.join(',')}`;
    return result;
  }

  const rows = parsed.data;
  result.totalRows = rows.length;

  if (rows.length === 0) {
    result.fatal = 'The file has a header but no data rows';
    return result;
  }
  if (rows.length > maxRows) {
    result.fatal = `File has ${rows.length} rows; the limit is ${maxRows}`;
    return result;
  }

  // Duplicate plates INSIDE the file. Without this the first insert succeeds
  // and the second trips the unique index, which reads to the operator as
  // "already exists" when the real problem is their own file.
  const seenPlates = new Map<string, number>();

  for (const [index, raw] of rows.entries()) {
    // 1-based, header excluded — the number the operator sees in Excel.
    const rowNumber = index + 1;

    const candidate = truckImportRowSchema.safeParse({
      plate: raw.plate ?? '',
      type: raw.type?.trim(),
      capacityTons: raw.capacityTons?.trim(),
      make: raw.make,
      model: raw.model,
    });

    if (!candidate.success) {
      for (const issue of candidate.error.issues) {
        pushError(result.errors, {
          row: rowNumber,
          field: String(issue.path[0] ?? 'row'),
          code: importErrorCodes.VALIDATION_FAILED,
          message: issue.message,
        });
      }
      continue;
    }

    const firstSeen = seenPlates.get(candidate.data.plate);
    if (firstSeen !== undefined) {
      pushError(result.errors, {
        row: rowNumber,
        field: 'plate',
        code: importErrorCodes.DUPLICATE_IN_FILE,
        message: `Plate ${candidate.data.plate} also appears on row ${firstSeen}`,
      });
      continue;
    }

    seenPlates.set(candidate.data.plate, rowNumber);
    result.valid.push({ row: rowNumber, data: candidate.data });
  }

  return result;
}

/**
 * Rows that did not make it. Exact by construction — every row either lands in
 * `valid` or produced at least one error — so this stays right even when the
 * error REPORT is capped and lists fewer rows than actually failed.
 */
export function failedRowCount(parsed: ParsedImport): number {
  return parsed.totalRows - parsed.valid.length;
}

/** RFC 4180 error report: `row,field,code,message` (§9.3.4). */
export function toErrorCsv(errors: ImportRowErrorDto[]): string {
  const escape = (value: string | number): string => {
    const text = String(value);
    // Formula-injection defence, same rule the jobs export uses: Excel executes
    // a leading =, +, - or @ in a cell.
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const lines = ['row,field,code,message'];
  for (const error of errors) {
    lines.push(
      [error.row, error.field, error.code, error.message].map((v) => escape(v)).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** The downloadable template: the header the parser demands, then the optional make and model. */
export function templateCsv(): string {
  const header = [...TRUCK_IMPORT_COLUMNS, ...TRUCK_IMPORT_OPTIONAL_COLUMNS].join(',');
  return `${header}\r\nKA-01-AB-1234,flatbed,5,Tata,407\r\nKA-05-MJ-7788,wheel_lift,3.5,,\r\n`;
}
