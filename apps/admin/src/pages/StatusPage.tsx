import type { ApiClient } from '../lib/api.js';
import { fmtDateTime, fmtNumber, statusFa } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { SystemStatus } from '../lib/types.js';
import { Badge, DataTable, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

/** E8-08: is the deployment itself healthy? Read-only by design. */
export function StatusPage({ api }: { api: ApiClient }): JSX.Element {
  const status = useResource<SystemStatus>(() => api.get<SystemStatus>('/v1/admin/status'), []);

  if (status.loading && !status.data) return <Notice>{fa.app.loading}</Notice>;
  if (status.error) return <Notice tone="error">{status.error.message}</Notice>;
  const data = status.data;
  if (!data) return <Notice>{fa.app.empty}</Notice>;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{fa.status.title}</h1>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={status.reload}>
          {fa.app.refresh}
        </button>
      </div>

      <div className="card grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-muted">{fa.status.mode}</p>
          <p className="font-bold">{data.mode === 'postgres' ? 'PostgreSQL' : 'حافظه موقت'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{fa.status.env}</p>
          <p className="font-bold">{data.nodeEnv}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{fa.status.version}</p>
          <p className="font-bold tnum">{data.version}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{fa.status.uptime}</p>
          <p className="font-bold tnum">{fmtNumber(data.uptimeSeconds)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{fa.status.settingsKeys}</p>
          <p className="font-bold tnum">{fmtNumber(data.settingsKeys)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{fa.status.serverTime}</p>
          <p className="font-bold">{fmtDateTime(data.serverTime)}</p>
        </div>
      </div>

      {data.mode === 'memory' ? (
        <Notice tone="error">
          در حالت حافظه موقت، داده‌ها با ری‌استارت پاک می‌شوند؛ فقط برای توسعه.
        </Notice>
      ) : null}

      <div className="card">
        <h2 className="mb-3 text-sm font-bold">{fa.status.checks}</h2>
        <DataTable
          rows={data.checks}
          empty={fa.app.empty}
          columns={[
            { key: 'name', header: 'بررسی', render: (row) => <span dir="ltr">{row.name}</span> },
            {
              key: 'ok',
              header: fa.sms.active,
              render: (row) => <Badge value={row.ok ? 'ACTIVE' : 'FAILED'} />,
            },
            { key: 'detail', header: 'توضیح', render: (row) => row.detailFa },
          ]}
        />
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-bold">{fa.status.providers}</h2>
        <DataTable
          rows={data.providers}
          empty={fa.app.empty}
          columns={[
            { key: 'kind', header: fa.sms.kind, render: (row) => statusFa(row.kind) },
            { key: 'provider', header: fa.sms.provider, render: (row) => row.provider },
            {
              key: 'active',
              header: fa.sms.active,
              render: (row) => <Badge value={row.isActive ? 'ACTIVE' : 'CANCELLED'} />,
            },
          ]}
        />
      </div>
    </section>
  );
}
