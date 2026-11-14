import { useMemo, useState } from 'react';
import { withOverrides, type Settings as SettingsShape } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { buildSettingRows, collectChanges, groupSettings } from '../lib/settings-form.js';
import { useResource } from '../lib/useResource.js';
import { Field, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

type SettingsPayload = { settings: Record<string, unknown> };

/** E8-05: every runtime knob, grouped, validated locally, applied without a deploy. */
export function SettingsPage({ api }: { api: ApiClient }): JSX.Element {
  const remote = useResource<SettingsPayload>(
    () => api.get<SettingsPayload>('/v1/admin/settings'),
    [],
  );
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const current = remote.data?.settings as SettingsShape | undefined;
  const rows = useMemo(() => (current ? buildSettingRows(current) : []), [current]);
  const sections = useMemo(() => groupSettings(rows), [rows]);

  const save = async (): Promise<void> => {
    if (!current) return;
    const { patch, errors: invalid } = collectChanges(rows, edits);
    setErrors(invalid);
    setMessage(null);
    if (Object.keys(invalid).length > 0) return;
    if (Object.keys(patch).length === 0) {
      setMessage('تغییری برای ذخیره نیست.');
      return;
    }
    // Fail fast on impossible combinations before the request leaves the panel.
    try {
      withOverrides(current, patch as Parameters<typeof withOverrides>[1]);
    } catch {
      setMessage('ترکیب مقادیر معتبر نیست.');
      return;
    }
    try {
      await api.patch('/v1/admin/settings', patch);
      setEdits({});
      remote.reload();
      setMessage('تنظیمات ذخیره شد.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : fa.app.error);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{fa.settings.title}</h1>
          <p className="text-xs text-muted">{fa.settings.hint}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          {fa.app.save}
        </button>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {remote.error ? <Notice tone="error">{remote.error.message}</Notice> : null}
      {Object.keys(errors).length > 0 ? (
        <Notice tone="error">مقادیر نامعتبر را اصلاح کنید.</Notice>
      ) : null}

      {sections.map((section) => (
        <div key={section.group} className="card space-y-3">
          <h2 className="text-sm font-bold">{section.labelFa}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.rows.map((row) => {
              const value = edits[row.key] ?? row.value;
              return (
                <Field
                  key={row.key}
                  label={fa.settings.keys[row.key as keyof typeof fa.settings.keys] ?? row.labelFa}
                  hint={
                    row.min !== null && row.max !== null
                      ? `بازه مجاز: ${row.min} تا ${row.max}`
                      : undefined
                  }
                  error={errors[row.key]}
                >
                  {row.kind === 'boolean' ? (
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={value === true}
                      onChange={(event) => setEdits({ ...edits, [row.key]: event.target.checked })}
                    />
                  ) : (
                    <input
                      className="input tnum"
                      dir={row.kind === 'number' ? 'ltr' : 'rtl'}
                      value={String(value)}
                      onChange={(event) => setEdits({ ...edits, [row.key]: event.target.value })}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
