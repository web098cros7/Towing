'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { TruckImportDto } from '@towing/api-contracts';
import { Download, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, CardContent, cn } from '@towing/web-ui';
import { dashboardKeys } from '@/features/dashboard/api/dashboard.keys';
import { env } from '@/lib/env';
import { errorsToCsv, previewCsv, uploadTruckCsv, type ImportPreview } from '../api/imports';
import { trucksKeys } from '../api/trucks.keys';

/**
 * Bulk truck import (§9.3.4): pick a file, see what will happen, then commit.
 *
 * The preview exists so a wrong header or a column of bad plates is caught
 * before the upload — the failure mode this replaces is uploading 400 rows and
 * being told "12 failed" with no idea which.
 *
 * Hand-rolled drawer, matching `ComplianceDrawer`; `web-ui` has no Drawer.
 */
export function BulkImportDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<TruckImportDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(selected: File | undefined): Promise<void> {
    setResult(null);
    setError(null);
    if (!selected) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(selected);
    setPreview(previewCsv(await selected.text()));
  }

  async function upload(): Promise<void> {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const imported = await uploadTruckCsv(file);
      setResult(imported);
      // New trucks change the list and the KPI tiles.
      void queryClient.invalidateQueries({ queryKey: trucksKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  function downloadErrors(): void {
    const errors = result?.errors ?? preview?.errors ?? [];
    if (errors.length === 0) return;

    // Mock mode has no server to fetch from, and in real mode the errors are
    // already in hand — building the file locally avoids a needless round trip
    // either way. The server serves the same report at
    // `/trucks/bulk/:id/errors.csv` for anyone coming back later.
    const blob = new Blob([errorsToCsv(errors)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `import-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const queued = result?.status === 'pending';

  return (
    <aside
      data-testid="bulk-import-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-border bg-card p-6 shadow-xl"
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Import trucks</h2>
          <p className="text-sm text-text-secondary">
            Upload a CSV to add many trucks at once.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close import">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="text-sm text-text-secondary file:mr-3 file:rounded-input file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-on-brand"
        />
        {/* Removes the guesswork about column names entirely. */}
        <a
          href={env.useMocks ? '#' : '/api/proxy/trucks/bulk/template.csv'}
          onClick={(e) => {
            if (!env.useMocks) return;
            e.preventDefault();
            const blob = new Blob(
              ['plate,type,capacityTons\r\nKA-01-AB-1234,flatbed,5\r\nKA-05-MJ-7788,wheel_lift,3.5\r\n'],
              { type: 'text/csv;charset=utf-8' },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'truck-import-template.csv';
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
        >
          <Download className="size-4" />
          Template
        </a>
      </div>

      <div className="flex-1 overflow-y-auto">
        {preview?.fatal ? (
          <Card className="border-error-soft-bg bg-error-soft-bg/40">
            <CardContent className="p-3 text-sm text-error-soft-fg">{preview.fatal}</CardContent>
          </Card>
        ) : null}

        {preview && !preview.fatal ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="success">{preview.validRows} ready</Badge>
              {preview.totalRows - preview.validRows > 0 ? (
                <Badge variant="error">{preview.totalRows - preview.validRows} with errors</Badge>
              ) : null}
              <span className="text-text-tertiary">of {preview.totalRows} rows</span>
            </div>

            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="py-1 pr-2 font-semibold">#</th>
                  <th className="py-1 pr-2 font-semibold">Plate</th>
                  <th className="py-1 pr-2 font-semibold">Type</th>
                  <th className="py-1 font-semibold">Capacity</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.row}
                    className={cn('border-t border-border', !row.ok && 'bg-error-soft-bg/30')}
                  >
                    <td className="py-1 pr-2 text-text-tertiary">{row.row}</td>
                    <td className="py-1 pr-2 font-medium">{row.plate}</td>
                    <td className="py-1 pr-2">{row.type}</td>
                    <td className="py-1">{row.capacityTons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.totalRows > preview.rows.length ? (
              <p className="mt-2 text-xs text-text-tertiary">
                Showing the first {preview.rows.length} rows; all {preview.totalRows} were checked.
              </p>
            ) : null}

            {preview.errors.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Problems
                </h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {preview.errors.slice(0, 8).map((e, i) => (
                    <li key={`${e.row}-${e.field}-${i}`} className="text-error-soft-fg">
                      Row {e.row} · {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
                {preview.errors.length > 8 ? (
                  <p className="mt-1 text-xs text-text-tertiary">
                    +{preview.errors.length - 8} more — download the report for the full list.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {error ? (
          <Card className="mt-4 border-error-soft-bg bg-error-soft-bg/40">
            <CardContent className="p-3 text-sm text-error-soft-fg">{error}</CardContent>
          </Card>
        ) : null}

        {result ? (
          <Card className="mt-4" data-testid="import-result">
            <CardContent className="p-3 text-sm">
              {queued ? (
                <p>
                  {result.totalRows} rows queued for import. Large files are processed in the
                  background — reload this page in a moment to see the result.
                </p>
              ) : (
                <p>
                  Imported <strong>{result.importedRows}</strong> of {result.totalRows} rows.
                  {result.failedRows > 0 ? ` ${result.failedRows} failed.` : ''}
                </p>
              )}
              {result.errors.length > 0 ? (
                <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={downloadErrors}>
                  <Download className="size-4" />
                  Download error report
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose}>
          {result ? 'Done' : 'Cancel'}
        </Button>
        <Button
          onClick={() => void upload()}
          disabled={!file || uploading || !!preview?.fatal || preview?.validRows === 0}
        >
          <Upload className="size-4" />
          {uploading ? 'Importing…' : `Import ${preview?.validRows ?? 0} truck(s)`}
        </Button>
      </div>
    </aside>
  );
}
