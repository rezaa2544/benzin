import { useEffect, type ReactNode } from 'react';
import { statusFa } from '../lib/format.js';

/** Small presentational kit shared by every screen (task E8-01). */

export function Badge({ value }: { value: string }): JSX.Element {
  const tone =
    value === 'COMPLETED' || value === 'ACTIVE' || value === 'PAID'
      ? 'bg-success/10 text-success'
      : value === 'OPEN' || value === 'PENDING' || value === 'PENDING_OWNER'
        ? 'bg-warning/10 text-warning'
        : value === 'DISPUTED' || value === 'FAILED' || value === 'BANNED' || value === 'SUSPENDED'
          ? 'bg-danger/10 text-danger'
          : 'bg-surface text-muted';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {statusFa(value)}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}): JSX.Element {
  return (
    <div className="card">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tnum">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: string;
  onRowClick?: (row: T) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
        {empty}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={onRowClick ? 'cursor-pointer hover:bg-surface' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-lg rounded-xl2 bg-raised p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onClose}>
            بستن
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}): JSX.Element {
  const page = Math.floor(offset / limit) + 1;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>
        صفحه {page.toLocaleString('fa-IR')} از {lastPage.toLocaleString('fa-IR')} —{' '}
        {total.toLocaleString('fa-IR')} ردیف
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          className="btn px-2 py-1"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          قبلی
        </button>
        <button
          type="button"
          className="btn px-2 py-1"
          disabled={page >= lastPage}
          onClick={() => onChange(offset + limit)}
        >
          بعدی
        </button>
      </span>
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
}): JSX.Element {
  const styles =
    tone === 'error'
      ? 'border-danger/30 bg-danger/5 text-danger'
      : tone === 'success'
        ? 'border-success/30 bg-success/5 text-success'
        : 'border-line bg-surface text-muted';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}
