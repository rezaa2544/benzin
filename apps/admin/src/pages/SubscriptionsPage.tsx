import { useState } from 'react';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { fmtDate, statusFa } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { Paged, SubscriptionRow } from '../lib/types.js';
import { Badge, DataTable, Notice, Pagination } from '../components/ui.js';
import fa from '../i18n/fa.json';

const LIMIT = 20;

/** E8-04: who is paying and until when. Read-only by design — money never edits itself. */
export function SubscriptionsPage({ api }: { api: ApiClient }): JSX.Element {
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const list = useResource<Paged<SubscriptionRow>>(
    () =>
      api.get<Paged<SubscriptionRow>>('/v1/admin/subscriptions', {
        status: status || undefined,
        limit: LIMIT,
        offset,
      }),
    [status, offset],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{fa.subscriptions.title}</h1>
        <select
          className="input w-40"
          value={status}
          onChange={(event) => {
            setOffset(0);
            setStatus(event.target.value as SubscriptionStatus | '');
          }}
        >
          <option value="">{fa.app.all}</option>
          {SUBSCRIPTION_STATUSES.map((item) => (
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
              columns={[
                {
                  key: 'phone',
                  header: fa.users.phone,
                  render: (row) => <span className="tnum">{row.phone ?? '—'}</span>,
                },
                {
                  key: 'plan',
                  header: fa.subscriptions.plan,
                  render: (row) => row.planNameFa ?? row.planCode ?? '—',
                },
                {
                  key: 'status',
                  header: fa.orders.status,
                  render: (row) => <Badge value={row.status} />,
                },
                {
                  key: 'start',
                  header: fa.subscriptions.startsAt,
                  render: (row) => fmtDate(row.startsAt),
                },
                {
                  key: 'end',
                  header: fa.subscriptions.endsAt,
                  render: (row) => fmtDate(row.endsAt),
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
    </section>
  );
}
