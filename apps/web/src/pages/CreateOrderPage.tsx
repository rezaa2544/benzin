import { useState } from 'react';
import {
  ORDER_SIDE_FA,
  TIER_RATE_TOMAN,
  formatToman,
  type OrderSide,
  type Tier,
} from '@benzin/shared';
import { errorMessage } from '../lib/api.js';
import type { ApiClient } from '../lib/api.js';
import type { MetaConfig, OrderView, ZoneView } from '../lib/types.js';
import { TIER_LABEL_FA } from '../lib/market.js';
import {
  EMPTY_ORDER_FORM,
  buyerSaving,
  validateOrderForm,
  type OrderFormValues,
} from '../lib/order-form.js';
import { navigate } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { FormField } from '../components/FormField.js';
import { Notice, PageTitle } from './parts.js';

export interface CreateOrderPageProps {
  api: ApiClient;
  config: MetaConfig | null;
  zones: ZoneView[];
  onCreated?: (order: OrderView) => void;
}

const SIDES: readonly OrderSide[] = ['SELL', 'BUY'];
const TIERS: readonly Tier[] = ['T1500', 'T3000', 'T10000'];

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  ORDER_LIMIT_REACHED: t('errors.ORDER_LIMIT_REACHED'),
  ZONE_NOT_SUPPORTED: t('errors.ZONE_NOT_SUPPORTED'),
  TRADE_CYCLE_BLOCKED: t('errors.TRADE_CYCLE_BLOCKED'),
  SUBSCRIPTION_REQUIRED: t('errors.SUBSCRIPTION_REQUIRED'),
  VALIDATION_ERROR: t('errors.VALIDATION_ERROR'),
};

/** New listing form (E9-07) with the same bounds and official-rate cap the API enforces. */
export function CreateOrderPage({
  api,
  config,
  zones,
  onCreated,
}: CreateOrderPageProps): JSX.Element {
  const [values, setValues] = useState<OrderFormValues>(EMPTY_ORDER_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof OrderFormValues, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');

  const bounds = {
    minLitres: config?.minLitres ?? 10,
    maxLitres: config?.maxLitres ?? 200,
  };
  const saving = buyerSaving(values.litres, values.rateToman, values.tier);

  const update = (patch: Partial<OrderFormValues>): void =>
    setValues((current) => ({ ...current, ...patch }));

  const submit = async (): Promise<void> => {
    setError(null);
    const result = validateOrderForm(values, bounds, {
      required: t('form.errorRequired'),
      litresRange: t('form.errorRange'),
      rateAboveOfficial: t('form.errorRange'),
      noteTooLong: t('form.errorRange'),
    });
    setErrors(result.errors);
    if (!result.payload) return;
    if (!zoneId) {
      setError(t('errors.ZONE_NOT_SUPPORTED'));
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<OrderView>('/v1/orders', { ...result.payload, zoneId });
      onCreated?.(created);
      navigate('/orders');
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle title={t('create.title')} lead={t('create.lead')} />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card">
        <div className="mb-4">
          <span className="label">{t('create.side')}</span>
          <div className="flex gap-2">
            {SIDES.map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={values.side === side}
                onClick={() => update({ side })}
                className={`btn flex-1 ${values.side === side ? 'btn-primary' : ''}`}
              >
                {ORDER_SIDE_FA[side]}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <span className="label">{t('create.tier')}</span>
          <div className="flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                aria-pressed={values.tier === tier}
                onClick={() => update({ tier })}
                className={`chip min-h-tap ${values.tier === tier ? 'bg-brandSoft text-brand' : ''}`}
              >
                {TIER_LABEL_FA[tier]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted tnum">
            {t('create.officialHint').replace('{rate}', formatToman(TIER_RATE_TOMAN[values.tier]))}
          </p>
        </div>

        {zones.length > 1 ? (
          <div className="mb-4">
            <label className="label" htmlFor="create-zone">
              {t('market.zone')}
            </label>
            <select
              id="create-zone"
              className="input"
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.nameFa}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <FormField
          label={t('create.litres')}
          hint={t('create.litresHint')
            .replace('{min}', String(bounds.minLitres))
            .replace('{max}', String(bounds.maxLitres))}
          error={errors.litres}
          required
        >
          {(field) => (
            <input
              {...field}
              className="input tnum"
              inputMode="numeric"
              value={values.litres}
              onChange={(event) => update({ litres: event.target.value })}
            />
          )}
        </FormField>

        <FormField label={t('create.rate')} error={errors.rateToman} required>
          {(field) => (
            <input
              {...field}
              className="input tnum"
              inputMode="numeric"
              value={values.rateToman}
              onChange={(event) => update({ rateToman: event.target.value })}
            />
          )}
        </FormField>

        {saving !== null ? (
          <p className="mb-2 text-xs text-success tnum">
            {t('create.saving').replace('{amount}', `${formatToman(Math.round(saving))} تومان`)}
          </p>
        ) : null}

        <FormField label={t('create.station')} error={errors.stationName}>
          {(field) => (
            <input
              {...field}
              className="input"
              maxLength={80}
              value={values.stationName}
              onChange={(event) => update({ stationName: event.target.value })}
            />
          )}
        </FormField>

        <FormField label={t('create.note')} error={errors.note}>
          {(field) => (
            <textarea
              {...field}
              className="input min-h-[5rem] py-2"
              maxLength={240}
              value={values.note}
              onChange={(event) => update({ note: event.target.value })}
            />
          )}
        </FormField>

        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t('create.submitting') : t('create.submit')}
        </button>
      </div>
    </div>
  );
}
