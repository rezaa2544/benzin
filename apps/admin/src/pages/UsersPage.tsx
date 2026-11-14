import { useState } from 'react';
import { USER_ROLES, type UserRole, type UserStatus } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { fmtDate, fmtDateTime, fmtNumber, statusFa } from '../lib/format.js';
import { canEditUser } from '../lib/permissions.js';
import { useResource } from '../lib/useResource.js';
import type { Paged, UserDetail, UserRow } from '../lib/types.js';
import { Badge, DataTable, Field, Modal, Notice, Pagination } from '../components/ui.js';
import type { SessionUser } from '../lib/session.js';
import fa from '../i18n/fa.json';

const LIMIT = 20;

/** E8-02: find a person, see their record, fix or restrict the account. */
export function UsersPage({
  api,
  user,
  focusId,
}: {
  api: ApiClient;
  user: SessionUser;
  focusId?: string | undefined;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(focusId ?? null);

  const list = useResource<Paged<UserRow>>(
    () =>
      api.get<Paged<UserRow>>('/v1/admin/users', {
        q: query,
        role: role || undefined,
        status: status || undefined,
        limit: LIMIT,
        offset,
      }),
    [query, role, status, offset],
  );

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-bold">{fa.users.title}</h1>

      <div className="card grid gap-3 sm:grid-cols-3">
        <Field label={fa.app.search}>
          <input
            className="input"
            value={query}
            placeholder={fa.users.searchHint}
            onChange={(event) => {
              setOffset(0);
              setQuery(event.target.value);
            }}
          />
        </Field>
        <Field label={fa.users.role}>
          <select
            className="input"
            value={role}
            onChange={(event) => {
              setOffset(0);
              setRole(event.target.value as UserRole | '');
            }}
          >
            <option value="">{fa.app.all}</option>
            {USER_ROLES.map((item) => (
              <option key={item} value={item}>
                {statusFa(item)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={fa.users.status}>
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setOffset(0);
              setStatus(event.target.value as UserStatus | '');
            }}
          >
            <option value="">{fa.app.all}</option>
            {(['ACTIVE', 'SUSPENDED', 'BANNED'] as const).map((item) => (
              <option key={item} value={item}>
                {statusFa(item)}
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
              onRowClick={(row) => setSelected(row.id)}
              columns={[
                {
                  key: 'phone',
                  header: fa.users.phone,
                  render: (row) => <span className="tnum">{row.phone}</span>,
                },
                { key: 'name', header: fa.users.name, render: (row) => row.displayName ?? '—' },
                { key: 'role', header: fa.users.role, render: (row) => <Badge value={row.role} /> },
                {
                  key: 'status',
                  header: fa.users.status,
                  render: (row) => <Badge value={row.status} />,
                },
                {
                  key: 'created',
                  header: fa.users.createdAt,
                  render: (row) => fmtDate(row.createdAt),
                },
                {
                  key: 'until',
                  header: fa.users.suspendUntil,
                  render: (row) => (row.suspendedUntil ? fmtDateTime(row.suspendedUntil) : '—'),
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
        <UserSheet
          api={api}
          actor={user}
          id={selected}
          onClose={() => setSelected(null)}
          onSaved={() => list.reload()}
        />
      ) : null}
    </section>
  );
}

function UserSheet({
  api,
  actor,
  id,
  onClose,
  onSaved,
}: {
  api: ApiClient;
  actor: SessionUser;
  id: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const detail = useResource<UserDetail>(() => api.get<UserDetail>(`/v1/admin/users/${id}`), [id]);
  const [role, setRole] = useState<UserRole | ''>('');
  const [hours, setHours] = useState('24');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await api.patch(`/v1/admin/users/${id}`, body);
      detail.reload();
      onSaved();
      setMessage('ذخیره شد.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  const target = detail.data;
  const mayEdit = target ? canEditUser(actor.role, target.role) : false;

  return (
    <Modal title={`${fa.users.detail} — ${target?.phone ?? ''}`} open onClose={onClose}>
      {detail.loading && !target ? <Notice>{fa.app.loading}</Notice> : null}
      {detail.error ? <Notice tone="error">{detail.error.message}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {target ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">{fa.users.reputation}</p>
              <p className="font-bold">
                {fmtNumber(target.reputation.score)} · {target.reputation.levelFa}
              </p>
            </div>
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">{fa.users.subscriptions}</p>
              <p className="font-bold">
                {target.subscription
                  ? `${target.subscription.planCode ?? '—'} · ${statusFa(target.subscription.status)}`
                  : fa.users.noSubscription}
              </p>
            </div>
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">{fa.users.orders}</p>
              <p className="font-bold">{fmtNumber(target.counts.orders)}</p>
            </div>
            <div className="rounded-lg border border-line p-2">
              <p className="text-muted">{fa.users.reservations}</p>
              <p className="font-bold">{fmtNumber(target.counts.reservations)}</p>
            </div>
          </div>

          {mayEdit ? (
            <>
              <Field label={fa.users.changeRole}>
                <select
                  className="input"
                  value={role || target.role}
                  onChange={(event) => setRole(event.target.value as UserRole)}
                >
                  {USER_ROLES.map((item) => (
                    <option
                      key={item}
                      value={item}
                      disabled={item === 'OWNER' && actor.role !== 'OWNER'}
                    >
                      {statusFa(item)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={fa.users.reason}>
                <input
                  className="input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="توضیح برای لاگ ممیزی"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!role || role === target.role}
                  onClick={() => void patch({ role, reason: reason || undefined })}
                >
                  {fa.app.save} {fa.users.role}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void patch({
                      status: 'SUSPENDED',
                      suspendHours: Number(hours),
                      reason: reason || 'تعلیق دستی',
                    })
                  }
                >
                  {fa.users.suspend}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void patch({ status: 'ACTIVE', reason: reason || undefined })}
                >
                  {fa.users.restore}
                </button>
              </div>
              <Field label={fa.users.suspendHours}>
                <input
                  className="input tnum"
                  dir="ltr"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
              </Field>
            </>
          ) : (
            <Notice>برای ویرایش این حساب دسترسی مدیریتی لازم است.</Notice>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
