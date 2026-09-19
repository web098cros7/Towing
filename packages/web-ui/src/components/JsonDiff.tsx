import { cn } from '../lib/cn';

/**
 * Before/after renderer for audit rows (W1 §3.3, §3.5).
 *
 * WHEN BOTH SIDES ARE PLAIN OBJECTS it renders a key-by-key comparison with
 * changed keys highlighted — the question an operator actually has is "what
 * changed", not "show me two JSON blobs". For anything else (arrays, scalars,
 * one side null) it falls back to side-by-side pretty JSON, because inventing
 * a diff for arrays is how diff views start lying.
 *
 * Values render as JSON strings, and `null`/`undefined` render as `—` so an
 * empty `before` (a create) is visibly empty rather than "null".
 */
export function JsonDiff({
  before,
  after,
  className,
}: {
  before: unknown;
  after: unknown;
  className?: string;
}) {
  if (isPlainObject(before) && isPlainObject(after)) {
    return <ObjectDiff before={before} after={after} className={className} />;
  }
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <JsonBlock label="Before" value={before} />
      <JsonBlock label="After" value={after} />
    </div>
  );
}

function ObjectDiff({
  before,
  after,
  className,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  className?: string;
}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  if (keys.length === 0) {
    return <p className={cn('text-sm text-text-tertiary', className)}>No recorded state.</p>;
  }

  return (
    <table className={cn('w-full text-left text-sm', className)} data-testid="json-diff">
      <thead>
        <tr className="text-xs text-text-secondary uppercase tracking-wide">
          <th className="py-1 pr-3 font-semibold">Field</th>
          <th className="py-1 pr-3 font-semibold">Before</th>
          <th className="py-1 font-semibold">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => {
          const from = before[key];
          const to = after[key];
          const changed = JSON.stringify(from) !== JSON.stringify(to);
          return (
            <tr
              key={key}
              data-testid={changed ? `diff-changed-${key}` : undefined}
              className={cn('border-t border-border align-top', changed && 'bg-warning-soft-bg/40')}
            >
              <td className="py-1.5 pr-3 font-medium">{key}</td>
              <td className="py-1.5 pr-3 text-text-secondary">{renderValue(from)}</td>
              <td className={cn('py-1.5', changed && 'font-medium')}>{renderValue(to)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-text-secondary uppercase tracking-wide">
        {label}
      </div>
      <pre className="overflow-x-auto rounded-input bg-surface1 p-3 text-xs text-text-primary">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
