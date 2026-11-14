import { useState } from 'react';
import { PAYMENT_STATUSES, type PaymentStatus } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { fmtDateTime, fmtToman, statusFa } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { PaymentCardRow, PaymentRow } from '../lib/types.js';
import { Badge, DataTable, Field, Modal, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

/** E8-04 + E7-07: manual settlement of card-to-card transfers and destination cards. */
export function PaymentsPage({ api }: { api: ApiClient }): JSX.Element {
  const [status, setStatus] = useState<PaymentStatus | ''>('PENDING');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [newCard, setNewCard] = useState(false);
  const [card, setCard] = useState({ cardNumber: '', holderName: '', bankName: '' });

  const payments = useResource<{ items: PaymentRow[] }>(
    () =>
      api.get<{ items: PaymentRow[] }>('/v1/admin/payments', {
        status: status || undefined,
        limit: 50,
      }),
    [status],
  );
  const cards = useResource<{ items: PaymentCardRow[] }>(
    () => api.get<{ items: PaymentCardRow[] }>('/v1/admin/payment-cards'),
    [],
  );

  const act = async (run: () => Promise<unknown>, success: string): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await run();
      setMessage(success);
      payments.reload();
      cards.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">{fa.payments.title}</h1>
        <div className="flex items-center gap-2">
          <select
            className="input w-40"
            value={status}
            onChange={(event) => setStatus(event.target.value as PaymentStatus | '')}
          >
            <option value="">{fa.app.all}</option>
            {PAYMENT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {statusFa(item)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void act(() => api.post('/v1/admin/reconciliation', {}), 'هم‌فرم‌سازی اجرا شد.')
            }
          >
            {fa.payments.reconcile}
          </button>
        </div>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card">
        {payments.loading && !payments.data ? (
          <Notice>{fa.app.loading}</Notice>
        ) : (
          <DataTable
            rows={payments.data?.items ?? []}
            empty={fa.app.empty}
            columns={[
              {
                key: 'amount',
                header: fa.payments.amount,
                render: (row) => fmtToman(row.amountToman),
              },
              {
                key: 'unique',
                header: fa.payments.unique,
                render: (row) =>
                  row.uniqueAmountToman === null ? '—' : fmtToman(row.uniqueAmountToman),
              },
              {
                key: 'provider',
                header: fa.payments.provider,
                render: (row) => statusFa(row.provider),
              },
              {
                key: 'status',
                header: fa.orders.status,
                render: (row) => <Badge value={row.status} />,
              },
              {
                key: 'reference',
                header: fa.payments.reference,
                render: (row) => <span className="tnum">{row.reference ?? '—'}</span>,
              },
              {
                key: 'created',
                header: fa.audit.createdAt,
                render: (row) => fmtDateTime(row.createdAt),
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.status === 'PENDING' ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-primary px-2 py-1 text-xs"
                        onClick={() =>
                          void act(
                            () => api.post(`/v1/admin/payments/${row.id}/confirm`, {}),
                            'پرداخت تأیید شد.',
                          )
                        }
                      >
                        {fa.payments.approve}
                      </button>
                      <button
                        type="button"
                        className="btn px-2 py-1 text-xs"
                        onClick={() => {
                          setRejecting(row);
                          setReason('');
                        }}
                      >
                        {fa.payments.reject}
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{fa.payments.cards}</h2>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setNewCard(true)}>
            {fa.payments.addCard}
          </button>
        </div>
        <DataTable
          rows={cards.data?.items ?? []}
          empty={fa.app.empty}
          columns={[
            {
              key: 'number',
              header: fa.payments.card,
              render: (row) => <span className="tnum">{row.maskedNumber}</span>,
            },
            { key: 'holder', header: fa.payments.holder, render: (row) => row.holderName },
            { key: 'bank', header: fa.payments.bank, render: (row) => row.bankName ?? '—' },
            {
              key: 'active',
              header: fa.users.status,
              render: (row) => <Badge value={row.isActive ? 'ACTIVE' : 'CANCELLED'} />,
            },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                row.isActive ? (
                  <button
                    type="button"
                    className="btn px-2 py-1 text-xs"
                    onClick={() =>
                      void act(
                        () => api.post(`/v1/admin/payment-cards/${row.id}/deactivate`, {}),
                        'کارت غیرفعال شد.',
                      )
                    }
                  >
                    {fa.payments.deactivate}
                  </button>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal
        title={fa.payments.reject}
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        footer={
          <button
            type="button"
            className="btn btn-danger"
            disabled={reason.trim().length < 3}
            onClick={() => {
              const target = rejecting;
              setRejecting(null);
              if (target) {
                void act(
                  () => api.post(`/v1/admin/payments/${target.id}/reject`, { reason }),
                  'پرداخت رد شد.',
                );
              }
            }}
          >
            {fa.app.confirm}
          </button>
        }
      >
        <Field label={fa.payments.rejectReason}>
          <input
            className="input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        title={fa.payments.addCard}
        open={newCard}
        onClose={() => setNewCard(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={card.cardNumber.length < 16 || card.holderName.trim().length < 2}
            onClick={() => {
              setNewCard(false);
              void act(() => api.post('/v1/admin/payment-cards', card), 'کارت اضافه شد.');
              setCard({ cardNumber: '', holderName: '', bankName: '' });
            }}
          >
            {fa.app.save}
          </button>
        }
      >
        <Field label={fa.payments.card} hint="۱۶ رقم، بدون فاصله">
          <input
            className="input tnum"
            dir="ltr"
            value={card.cardNumber}
            onChange={(event) => setCard({ ...card, cardNumber: event.target.value })}
          />
        </Field>
        <Field label={fa.payments.holder}>
          <input
            className="input"
            value={card.holderName}
            onChange={(event) => setCard({ ...card, holderName: event.target.value })}
          />
        </Field>
        <Field label={fa.payments.bank}>
          <input
            className="input"
            value={card.bankName}
            onChange={(event) => setCard({ ...card, bankName: event.target.value })}
          />
        </Field>
      </Modal>
    </section>
  );
}
