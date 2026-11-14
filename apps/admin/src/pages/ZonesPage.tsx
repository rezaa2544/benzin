import { useState } from 'react';
import type { ApiClient } from '../lib/api.js';
import { fmtNumber } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { ZoneRow } from '../lib/types.js';
import { Badge, DataTable, Field, Modal, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

/**
 * E8-07: cities are polygons; activating one is what opens the market there.
 * The boundary editor takes one `lng,lat` pair per line — no GIS tooling required.
 */
export function ZonesPage({ api }: { api: ApiClient }): JSX.Element {
  const zones = useResource<{ items: ZoneRow[] }>(
    () => api.get<{ items: ZoneRow[] }>('/v1/admin/zones'),
    [],
  );
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: '',
    nameFa: '',
    city: '',
    province: 'کردستان',
    isActive: true,
    boundary: '',
  });

  const save = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    const boundary = form.boundary
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(',').map((part) => Number(part.trim())));
    if (
      boundary.some((pair) => pair.length !== 2 || pair.some((value) => !Number.isFinite(value)))
    ) {
      setError('هر خط باید دو عدد «طول,عرض» باشد.');
      return;
    }
    try {
      await api.put('/v1/admin/zones', {
        slug: form.slug,
        nameFa: form.nameFa,
        city: form.city,
        province: form.province,
        isActive: form.isActive,
        boundary,
      });
      setOpen(false);
      zones.reload();
      setMessage(fa.zones.saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{fa.zones.title}</h1>
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
        >
          {fa.zones.add}
        </button>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card">
        {zones.loading && !zones.data ? (
          <Notice>{fa.app.loading}</Notice>
        ) : (
          <DataTable
            rows={zones.data?.items ?? []}
            empty={fa.app.empty}
            columns={[
              { key: 'name', header: fa.zones.name, render: (row) => row.nameFa },
              {
                key: 'slug',
                header: fa.zones.slug,
                render: (row) => <span dir="ltr">{row.slug}</span>,
              },
              { key: 'province', header: fa.zones.province, render: (row) => row.province },
              {
                key: 'vertices',
                header: fa.zones.vertices,
                render: (row) => fmtNumber(row.vertices),
              },
              {
                key: 'active',
                header: fa.zones.active,
                render: (row) => <Badge value={row.isActive ? 'ACTIVE' : 'CANCELLED'} />,
              },
            ]}
          />
        )}
      </div>

      <Modal
        title={fa.zones.add}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              form.slug.length < 2 || form.nameFa.length < 2 || form.boundary.trim().length === 0
            }
            onClick={() => void save()}
          >
            {fa.app.save}
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={fa.zones.slug} hint="حروف کوچک لاتین و خط تیره">
            <input
              className="input"
              dir="ltr"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
          </Field>
          <Field label={fa.zones.name}>
            <input
              className="input"
              value={form.nameFa}
              onChange={(event) => setForm({ ...form, nameFa: event.target.value })}
            />
          </Field>
          <Field label={fa.zones.city}>
            <input
              className="input"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
          </Field>
          <Field label={fa.zones.province}>
            <input
              className="input"
              value={form.province}
              onChange={(event) => setForm({ ...form, province: event.target.value })}
            />
          </Field>
        </div>
        <Field label={fa.zones.boundary} hint="مثال: 45.83,35.96 (حداقل ۳ رأس)">
          <textarea
            className="input tnum h-32"
            dir="ltr"
            value={form.boundary}
            onChange={(event) => setForm({ ...form, boundary: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          {fa.zones.active}
        </label>
      </Modal>
    </section>
  );
}
