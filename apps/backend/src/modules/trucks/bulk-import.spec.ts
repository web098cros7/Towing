import { describe, expect, it } from 'vitest';
import { failedRowCount, parseTruckCsv, templateCsv, toErrorCsv } from './bulk-import';

const HEADER = 'plate,type,capacityTons';
const MAX = 10_000;

describe('parseTruckCsv', () => {
  it('accepts a well-formed file', () => {
    const parsed = parseTruckCsv(
      `${HEADER}\nKA-01-AB-1234,flatbed,5\nKA-05-MJ-7788,wheel_lift,3.5`,
      MAX,
    );

    expect(parsed.fatal).toBeUndefined();
    expect(parsed.totalRows).toBe(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.valid.map((v) => v.data)).toEqual([
      { plate: 'KA-01-AB-1234', type: 'flatbed', capacityTons: 5 },
      { plate: 'KA-05-MJ-7788', type: 'wheel_lift', capacityTons: 3.5 },
    ]);
  });

  it('uppercases plates so case cannot smuggle a duplicate past the unique index', () => {
    const parsed = parseTruckCsv(`${HEADER}\nka-01-ab-1234,flatbed,5`, MAX);
    expect(parsed.valid[0]?.data.plate).toBe('KA-01-AB-1234');
  });

  it('rejects a missing column as fatal rather than failing every row', () => {
    const parsed = parseTruckCsv('plate,type\nKA-01-AB-1234,flatbed', MAX);

    // 4,000 copies of "capacityTons is required" would hide the real problem.
    expect(parsed.fatal).toContain('capacityTons');
    expect(parsed.errors).toEqual([]);
  });

  it('rejects a header-only file and an oversized one', () => {
    expect(parseTruckCsv(HEADER, MAX).fatal).toContain('no data rows');

    const big = [HEADER, ...Array.from({ length: 5 }, (_, i) => `KA-0${i},flatbed,5`)].join('\n');
    expect(parseTruckCsv(big, 3).fatal).toContain('the limit is 3');
  });

  it('reports row numbers the way the operator sees them in Excel', () => {
    const parsed = parseTruckCsv(
      `${HEADER}\nKA-01-AB-1234,flatbed,5\nBAD,flatbed,5\nKA-02-CD-5678,flatbed,5`,
      MAX,
    );

    // Header excluded, 1-based: the bad row is row 2.
    expect(parsed.errors[0]).toMatchObject({ row: 2, field: 'plate', code: 'validation_failed' });
    expect(parsed.valid).toHaveLength(2);
  });

  it('flags every bad field on a row', () => {
    const parsed = parseTruckCsv(`${HEADER}\nAB,tricycle,zero`, MAX);

    expect(parsed.errors.map((e) => e.field).sort()).toEqual(['capacityTons', 'plate', 'type']);
    expect(parsed.valid).toHaveLength(0);
  });

  it('rejects a non-positive or absurd capacity', () => {
    const parsed = parseTruckCsv(`${HEADER}\nKA-01-AB-1234,flatbed,0\nKA-02-CD-5678,flatbed,500`, MAX);
    expect(parsed.valid).toHaveLength(0);
    expect(parsed.errors.every((e) => e.field === 'capacityTons')).toBe(true);
  });

  it('catches a plate duplicated inside the file, naming the first row', () => {
    const parsed = parseTruckCsv(
      `${HEADER}\nKA-01-AB-1234,flatbed,5\nKA-09-ZZ-0000,flatbed,5\nka-01-ab-1234,wheel_lift,3`,
      MAX,
    );

    // Without this the second insert trips the unique index and reads as
    // "already exists in your fleet" when the file is the problem.
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.errors[0]).toMatchObject({ row: 3, code: 'duplicate_in_file' });
    expect(parsed.errors[0]?.message).toContain('row 1');
  });

  it('tolerates blank lines, padded headers and trailing whitespace', () => {
    const parsed = parseTruckCsv(
      ` plate , type , capacityTons \n\nKA-01-AB-1234 , flatbed , 5 \n\n`,
      MAX,
    );
    expect(parsed.fatal).toBeUndefined();
    expect(parsed.valid).toHaveLength(1);
  });

  it('counts failures exactly even when the report is capped', () => {
    const rows = Array.from({ length: 600 }, () => 'BAD,flatbed,5').join('\n');
    const parsed = parseTruckCsv(`${HEADER}\n${rows}`, MAX);

    expect(parsed.errors.length).toBe(500);
    // The report is truncated; the count must not be.
    expect(failedRowCount(parsed)).toBe(600);
  });
});

describe('toErrorCsv', () => {
  it('emits the §9.3.4 header and quotes correctly', () => {
    const csv = toErrorCsv([
      { row: 2, field: 'plate', code: 'validation_failed', message: 'Too short' },
    ]);
    expect(csv.split('\r\n')[0]).toBe('row,field,code,message');
    expect(csv).toContain('"2","plate","validation_failed","Too short"');
  });

  it('escapes embedded quotes and defuses formula injection', () => {
    const csv = toErrorCsv([
      { row: 1, field: 'plate', code: 'x', message: 'He said "no"' },
      { row: 2, field: 'plate', code: 'x', message: '=cmd|/c calc' },
    ]);
    expect(csv).toContain('"He said ""no"""');
    // Excel executes a leading '=' — same defence as the jobs export.
    expect(csv).toContain(`"'=cmd|/c calc"`);
  });
});

describe('templateCsv', () => {
  it('round-trips through the parser it is a template for', () => {
    const parsed = parseTruckCsv(templateCsv(), MAX);
    expect(parsed.fatal).toBeUndefined();
    expect(parsed.errors).toEqual([]);
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.valid[0]!.data).toMatchObject({ make: 'Tata', model: '407' });
  });
});

describe('make and model columns', () => {
  it('are optional: a file without them still imports', () => {
    const parsed = parseTruckCsv('plate,type,capacityTons\nKA-01-AB-1234,flatbed,5\n', MAX);
    expect(parsed.errors).toEqual([]);
    expect(parsed.valid[0]!.data.make).toBeUndefined();
  });

  it('are trimmed, and a too-long one fails its row only', () => {
    const long = 'X'.repeat(41);
    const parsed = parseTruckCsv(
      `plate,type,capacityTons,make,model\nKA-01-AB-1234,flatbed,5, Tata ,407\nKA-01-AB-9999,flatbed,5,${long},\n`,
      MAX,
    );
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.valid[0]!.data).toMatchObject({ make: 'Tata', model: '407' });
    expect(parsed.errors).toEqual([expect.objectContaining({ row: 2, field: 'make' })]);
  });
});
