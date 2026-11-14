import { useState } from 'react';
import type { ApiClient } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { AuditRow, Paged } from '../lib/types.js';
import { DataTable, Field, Notice, Pagination } from '../components/ui.js';
import fa from '../i18n/fa.json';

const LIMIT = 50;
const ENTITIES = [
  'user',
  'order',
  'reservation',
  'payment',
  'subscription',
  'zone',
  'provider',
  'settings',
];

/** E8-09: who changed what, when — the answer to every "who did that?" question. */
export function AuditPage({ api }: { api: ApiClient }): JSX.Element {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [offset, setOffset] = useState(0);

  const list = useResource<Paged<AuditRow>>(
    () =>
      api.get<Paged<AuditRow>>('/v1/admin/audit', {
        action: action || undefined,
        entity: entity || undefined,
        limit: LIMIT,
        offset,
      }),
    [action, entity, offset],
  );

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-bold">{fa.audit.title}</h1>

      <div className="card grid gap-3 sm:grid-cols-2">
        <Field label={fa.audit.actionFilter} hint="پیشوند رخداد، مثلاً payment.">
          <input
            className="input"
            dir="ltr"
            value={action}
            onChange={(event) => {
              setOffset(0);
              setAction(event.target.value);
            }}
          />
        </Field>
        <Field label={fa.audit.entity}>
          <select
            className="input"
            value={entity}
            onChange={(event) => {
              setOffset(0);
              setEntity(event.target.value);
            }}
          >
            <option value="">{fa.app.all}</option>
            {ENTITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
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
                  key: 'action',
                  header: fa.audit.action,
                  render: (row) => <span dir="ltr">{row.action}</span>,
                },
                { key: 'entity', header: fa.audit.entity, render: (row) => row.entity },
                {
                  key: 'entityId',
                  header: fa.audit.entityId,
                  render: (row) => (
                    <span className="tnum" dir="ltr">
                      {row.entityId.slice(0, 8)}
                    </span>
                  ),
                },
                {
                  key: 'actor',
                  header: fa.audit.actor,
                  render: (row) => (
                    <span className="tnum" dir="ltr">
                      {row.actorId?.slice(0, 8) ?? '—'}
                    </span>
                  ),
                },
                {
                  key: 'time',
                  header: fa.audit.createdAt,
                  render: (row) => fmtDateTime(row.createdAt),
                },
                {
                  key: 'meta',
                  header: fa.audit.metadata,
                  render: (row) => (
                    <span className="block max-w-xs truncate text-xs text-muted" dir="ltr">
                      {JSON.stringify(row.metadata)}
                    </span>
                  ),
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
