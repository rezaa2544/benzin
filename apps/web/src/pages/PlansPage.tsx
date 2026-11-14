import { useCallback, useState } from 'react';
import { formatJalaliDate, formatToman, toPersianDigits } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { PaymentStartView, PlanView, SubscriptionView } from '../lib/types.js';
import { useResource } from '../lib/useResource.js';
import { t, tf } from '../lib/i18n.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface PlansPageProps {
  api: ApiClient;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  PLAN_NOT_FOUND: t('plans.noPlans'),
  SUBSCRIPTION_REQUIRED: t('errors.SUBSCRIPTION_REQUIRED'),
};

/** Subscription plans (E9-13). Card-to-card is the default method; the API returns the
 *  destination card and a Persian instruction the client shows verbatim. */
export function PlansPage({ api }: PlansPageProps): JSX.Element {
  const [pending, setPending] = useState<PaymentStartView | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [plans, subscription] = await Promise.all([
      api.get<{ items: PlanView[] }>('/v1/plans'),
      api.get<{ subscription: SubscriptionView | null }>('/v1/me/subscription'),
    ]);
    return { plans: plans.items, subscription: subscription.subscription };
  }, [api]);

  const { data, loading, error: loadError } = useResource(load, [api]);

  const buy = async (plan: PlanView): Promise<void> => {
    setBusyCode(plan.code);
    setError(null);
    try {
      const started = await api.post<PaymentStartView>('/v1/subscriptions', {
        planCode: plan.code,
        method: 'CARD_TO_CARD',
      });
      setPending(started);
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div>
      <PageTitle title={t('plans.title')} lead={t('plans.lead')} />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loadError ? <Notice tone="error">{errorMessage(loadError, errorMap)}</Notice> : null}

      {loading ? (
        <Skeleton rows={2} />
      ) : (
        <>
          {data?.subscription ? (
            <div className="card mb-3 border-brand/40 bg-brandSoft">
              <p className="text-sm font-bold">{data.subscription.planNameFa}</p>
              <p className="text-xs text-muted tnum">
                {tf('plans.daysRemaining', {
                  days: toPersianDigits(data.subscription.daysRemaining),
                })}{' '}
                · {t('plans.expiresAt')} {formatJalaliDate(data.subscription.endsAt)}
              </p>
            </div>
          ) : null}

          {pending ? (
            <div className="card mb-3">
              <h2 className="mb-1 text-sm font-bold">{t('plans.payTitle')}</h2>
              <p className="mb-2 text-xs text-muted">{pending.instructionFa}</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">{t('common.toman')}</dt>
                <dd className="text-end tnum font-bold">{formatToman(pending.amountToman)}</dd>
                {pending.destination ? (
                  <>
                    <dt className="text-muted">{t('plans.cardNumber')}</dt>
                    <dd className="text-end tnum" dir="ltr">
                      {pending.destination.cardNumber}
                    </dd>
                    <dt className="text-muted">{t('plans.holder')}</dt>
                    <dd className="text-end">{pending.destination.holderName}</dd>
                  </>
                ) : null}
              </dl>
              {pending.redirectUrl ? (
                <a className="btn btn-primary mt-3 w-full" href={pending.redirectUrl}>
                  {t('plans.openGateway')}
                </a>
              ) : (
                <Notice tone="warning">{t('plans.pending')}</Notice>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {(data?.plans.length ?? 0) === 0 ? (
              <Notice tone="info">{t('plans.noPlans')}</Notice>
            ) : (
              data?.plans.map((plan) => (
                <div key={plan.id} className="card">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-base font-bold">{plan.nameFa}</h3>
                    <span className="text-sm font-bold tnum">{plan.priceLabelFa}</span>
                  </div>
                  <p className="mb-3 text-xs text-muted tnum">
                    {tf('plans.duration', { days: toPersianDigits(plan.durationDays) })} ·{' '}
                    {tf('plans.orders', { count: toPersianDigits(plan.maxActiveOrders) })}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary w-full"
                    disabled={busyCode !== null}
                    onClick={() => void buy(plan)}
                  >
                    {busyCode === plan.code ? t('plans.buying') : t('plans.buy')}
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
