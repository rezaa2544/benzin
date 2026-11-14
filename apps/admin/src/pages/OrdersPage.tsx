import { useState } from 'react';
import { ORDER_STATUSES, type OrderStatus } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { fmtDateTime, fmtNumber, fmtToman, statusFa } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { OrderDetail, OrderRow, Paged } from '../lib/types.js';
import { Badge, DataTable, Field, Modal, Notice, Pagination } from '../components/ui.js';
import fa from '../i18n/fa.json';

const LIMIT = 20;

/** E8-03: watch the market and close disputes with a recorded decision. */
export function OrdersPage({
  api,
  focusId,
}: {
  api: ApiClient;
  focusId?: string | undefined;
}): JSX.Element {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(focusId ?? null);

  const list = useResource<Paged<OrderRow>>(
    () =>
      api.get<Paged<OrderRow>>('/v1/admin/orders', {
        status: status || undefined,
        limit: LIMIT,
        offset,
      }),
    [status, offset],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">{fa.orders.title}</h1>
        <select
          className="input w-48"
          value={status}
          onChange={(event) => {
            setOffset(0);
            setStatus(event.target.value as OrderStatus | '');
          }}
        >
          <option value="">{fa.app.all}</option>
          {ORDER_STATUSES.map((item) => (
            <option key={item} value={item}>
              {statusFa(item)}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        {list.error ? (
          <Notice tone="error">{list.error.message}</Notice>
        ) : list.loading && !list.data ? (
          <Notice>{fa.app.loading}</Notice>
        ) : (
          <>
            <DataTable
              rows={list.data?.items ?? []}
              empty={fa.app.empty}
              onRowClick={(row) => setSelected(row.id)}
              columns={[
                {
                  key: 'owner',
                  header: fa.orders.owner,
                  render: (row) => (
                    <span className="tnum">{row.ownerPhone ?? row.ownerId.slice(0, 8)}</span>
                  ),
                },
                {
                  key: 'litres',
                  header: fa.orders.litres,
                  render: (row) => `${statusFa(row.side)} · ${fmtNumber(row.litres)} لیتر`,
                },
                { key: 'tier', header: fa.users.role, render: (row) => statusFa(row.tier) },
                { key: 'rate', header: fa.orders.rate, render: (row) => fmtToman(row.rateToman) },
                {
                  key: 'total',
                  header: fa.orders.total,
                  render: (row) => fmtToman(row.totalToman),
                },
                {
                  key: 'status',
                  header: fa.orders.status,
                  render: (row) => <Badge value={row.status} />,
                },
                {
                  key: 'created',
                  header: fa.audit.createdAt,
                  render: (row) => fmtDateTime(row.createdAt),
                },
              ]}
            />
            <Pagination
              total={list.data?.total ?? 0}
              limit={LIMIT}
              offset={offset}
              onChange={setOffset}
            />
          </>
        )}
      </div>

      {selected ? (
        <OrderSheet
          api={api}
          id={selected}
          onClose={() => setSelected(null)}
          onResolved={() => list.reload()}
        />
      ) : null}
    </section>
  );
}

function OrderSheet({
  api,
  id,
  onClose,
  onResolved,
}: {
  api: ApiClient;
  id: string;
  onClose: () => void;
  onResolved: () => void;
}): JSX.Element {
  const detail = useResource<OrderDetail>(
    () => api.get<OrderDetail>(`/v1/admin/orders/${id}`),
    [id],
  );
  const [outcome, setOutcome] = useState<'COMPLETE' | 'CANCEL'>('COMPLETE');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const order = detail.data;

  const resolve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/admin/orders/${id}/resolve`, { outcome, note });
      detail.reload();
      onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${fa.orders.detail} — ${id.slice(0, 8)}`} open onClose={onClose}>
      {detail.loading && !order ? <Notice>{fa.app.loading}</Notice> : null}
      {detail.error ? <Notice tone="error">{detail.error.message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {order ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted">{fa.orders.status}</p>
              <Badge value={order.status} />
            </div>
            <div>
              <p className="text-muted">{fa.orders.total}</p>
              <p className="font-bold">{fmtToman(order.totalToman)}</p>
            </div>
            <div>
              <p className="text-muted">{fa.orders.station}</p>
              <p>{order.stationName ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted">{fa.orders.owner}</p>
              <p className="tnum">{order.ownerPhone ?? '—'}</p>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-muted">{fa.orders.reservations}</p>
            <DataTable
              rows={order.reservations}
              empty={fa.app.empty}
              columns={[
                {
                  key: 'taker',
                  header: fa.orders.taker,
                  render: (row) => (
                    <span className="tnum">{row.takerPhone ?? row.takerId.slice(0, 8)}</span>
                  ),
                },
                {
                  key: 'status',
                  header: fa.orders.status,
                  render: (row) => <Badge value={row.status} />,
                },
                {
                  key: 'time',
                  header: fa.audit.createdAt,
                  render: (row) => fmtDateTime(row.createdAt),
                },
              ]}
            />
          </div>

          {order.status === 'DISPUTED' ? (
            <div className="space-y-2 rounded-lg border border-danger/30 p-3">
              <Field label={fa.orders.outcome}>
                <select
                  className="input"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value as 'COMPLETE' | 'CANCEL')}
                >
                  <option value="COMPLETE">{fa.orders.complete}</option>
                  <option value="CANCEL">{fa.orders.cancel}</option>
                </select>
              </Field>
              <Field label={fa.orders.note}>
                <input
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || note.trim().length < 3}
                onClick={() => void resolve()}
              >
                {fa.orders.resolve}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
