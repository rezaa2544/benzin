import type { ApiClient } from '../lib/api.js';
import { fmtDateTime, statusFa } from '../lib/format.js';
import { useResource } from '../lib/useResource.js';
import type { Dashboard } from '../lib/types.js';
import { DataTable, Notice, StatCard } from '../components/ui.js';
import fa from '../i18n/fa.json';

/** E8-08: the first screen after login — is the market healthy right now? */
export function DashboardPage({ api }: { api: ApiClient }): JSX.Element {
  const { data, error, loading, reload } = useResource<Dashboard>(
    () => api.get<Dashboard>('/v1/admin/dashboard'),
    [],
  );

  if (loading && !data) return <Notice>{fa.app.loading}</Notice>;
  if (error) {
    return (
      <div className="space-y-3">
        <Notice tone="error">
          {fa.errors[error.code as keyof typeof fa.errors] ?? error.message}
        </Notice>
        <button type="button" className="btn" onClick={reload}>
          {fa.app.retry}
        </button>
      </div>
    );
  }
  if (!data) return <Notice>{fa.app.empty}</Notice>;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{fa.dashboard.title}</h1>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {fa.dashboard.generatedAt} {fmtDateTime(data.generatedAt)}
          </span>
          <button type="button" className="btn px-2 py-1" onClick={reload}>
            {fa.app.refresh}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.tiles.map((tile) => (
          <StatCard key={tile.labelFa} label={tile.labelFa} value={tile.value} hint={tile.hintFa} />
        ))}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-bold">{fa.dashboard.recentAudit}</h2>
        <DataTable
          rows={data.recentAudit}
          empty={fa.app.empty}
          columns={[
            { key: 'action', header: fa.audit.action, render: (row) => row.action },
            { key: 'entity', header: fa.audit.entity, render: (row) => statusFa(row.entity) },
            {
              key: 'time',
              header: fa.audit.createdAt,
              render: (row) => fmtDateTime(row.createdAt),
            },
          ]}
        />
      </div>
    </section>
  );
}
