import { useState } from 'react';
import type { ApiClient } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import type { ProviderRow } from '../lib/types.js';
import { Badge, DataTable, Field, Modal, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

const emptyProvider: ProviderRow = {
  id: '',
  provider: '',
  kind: 'SMS',
  isActive: true,
  config: {},
};

/** E8-06: SMS provider credentials, masked forever after the first save. */
export function SmsPage({ api }: { api: ApiClient }): JSX.Element {
  const providers = useResource<{ items: ProviderRow[] }>(
    () => api.get<{ items: ProviderRow[] }>('/v1/admin/providers'),
    [],
  );
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [form, setForm] = useState({ provider: '', apiKey: '', sender: '', isActive: true });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');

  const open = (row: ProviderRow): void => {
    setEditing(row);
    setForm({
      provider: row.provider,
      apiKey: '',
      sender: String(row.config.sender ?? ''),
      isActive: row.isActive,
    });
  };

  const save = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await api.put('/v1/admin/providers', {
        provider: form.provider,
        kind: 'SMS',
        isActive: form.isActive,
        config: {
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          ...(form.sender ? { sender: form.sender } : {}),
        },
      });
      setEditing(null);
      providers.reload();
      setMessage('ارائه‌دهنده ذخیره شد.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  const test = async (row: ProviderRow): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await api.post(`/v1/admin/providers/${row.kind}/${row.provider}/test`, { phone: testPhone });
      setMessage(fa.sms.testSent);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  const smsProviders = (providers.data?.items ?? []).filter((row) => row.kind === 'SMS');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{fa.sms.title}</h1>
          <p className="text-xs text-muted">{fa.sms.hint}</p>
        </div>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => open(emptyProvider)}>
          {fa.payments.addCard.replace('کارت', 'ارائه‌دهنده')}
        </button>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card space-y-3">
        {providers.loading && !providers.data ? (
          <Notice>{fa.app.loading}</Notice>
        ) : (
          <DataTable
            rows={smsProviders}
            empty={fa.app.empty}
            columns={[
              { key: 'provider', header: fa.sms.provider, render: (row) => row.provider },
              {
                key: 'sender',
                header: fa.sms.sender,
                render: (row) => <span className="tnum">{String(row.config.sender ?? '—')}</span>,
              },
              {
                key: 'active',
                header: fa.sms.active,
                render: (row) => <Badge value={row.isActive ? 'ACTIVE' : 'CANCELLED'} />,
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn px-2 py-1 text-xs"
                      onClick={() => open(row)}
                    >
                      {fa.app.save}
                    </button>
                    <button
                      type="button"
                      className="btn px-2 py-1 text-xs"
                      disabled={testPhone.length < 11}
                      onClick={() => void test(row)}
                    >
                      {fa.sms.test}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
        <Field label={fa.sms.testPhone} hint="برای دکمه‌ی آزمایش، شماره را کامل وارد کنید.">
          <input
            className="input tnum w-48"
            dir="ltr"
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
          />
        </Field>
      </div>

      <Modal
        title={fa.sms.title}
        open={editing !== null}
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={form.provider.trim().length < 2}
            onClick={() => void save()}
          >
            {fa.app.save}
          </button>
        }
      >
        <Field label={fa.sms.provider} hint="مثلاً kavenegar یا smsir">
          <input
            className="input"
            dir="ltr"
            value={form.provider}
            onChange={(event) => setForm({ ...form, provider: event.target.value })}
          />
        </Field>
        <Field label={fa.sms.apiKey} hint="پس از ذخیره فقط «••••» نمایش داده می‌شود.">
          <input
            className="input"
            dir="ltr"
            type="password"
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
          />
        </Field>
        <Field label={fa.sms.sender}>
          <input
            className="input tnum"
            dir="ltr"
            value={form.sender}
            onChange={(event) => setForm({ ...form, sender: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          {fa.sms.active}
        </label>
      </Modal>
    </section>
  );
}
