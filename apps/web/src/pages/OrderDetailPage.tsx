import { useEffect, useState } from 'react';
import {
  ORDER_SIDE_FA,
  TIER_RATE_TOMAN,
  formatJalaliDateTime,
  formatToman,
  toPersianDigits,
} from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { OrderView, PublicUser, ReservationView } from '../lib/types.js';
import { TIER_LABEL_FA } from '../lib/market.js';
import { navigate } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface OrderDetailPageProps {
  api: ApiClient;
  user: PublicUser;
  orderId: string;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  ORDER_NOT_AVAILABLE: t('errors.ORDER_NOT_AVAILABLE'),
  ORDER_LIMIT_REACHED: t('errors.ORDER_LIMIT_REACHED'),
  RESERVATION_LIMIT_REACHED: t('errors.RESERVATION_LIMIT_REACHED'),
  TRADE_CYCLE_BLOCKED: t('errors.TRADE_CYCLE_BLOCKED'),
  SUBSCRIPTION_REQUIRED: t('errors.SUBSCRIPTION_REQUIRED'),
  INVALID_STATE_TRANSITION: t('errors.INVALID_STATE_TRANSITION'),
};

/** Order detail with the reserve action (E9-08). The API owns every rule; we surface them. */
export function OrderDetailPage({ api, user, orderId }: OrderDetailPageProps): JSX.Element {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<OrderView>(`/v1/orders/${orderId}`)
      .then((result) => {
        if (!cancelled) {
          setOrder(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, errorMap));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, orderId]);

  const reserve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const reservation = await api.post<ReservationView>(`/v1/orders/${orderId}/reservations`);
      setInfo(t('orderDetail.reserveSuccess'));
      navigate(`/trade/${reservation.id}`);
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={4} />;
  if (!order) {
    return (
      <div>
        <PageTitle title={t('orderDetail.title')} />
        <Notice tone="error">{error ?? t('errors.NOT_FOUND')}</Notice>
      </div>
    );
  }

  const mine = order.ownerId === user.id;
  const official = TIER_RATE_TOMAN[order.tier];

  return (
    <div>
      <PageTitle title={t('orderDetail.title')} lead={order.stationName ?? ''} />

      {info ? <Notice tone="success">{info}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card mb-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="chip">{TIER_LABEL_FA[order.tier]}</span>
          <span className="chip">{ORDER_SIDE_FA[order.side]}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-bold tnum">{toPersianDigits(order.litres)}</span>
          <span className="text-muted">{t('common.litre')}</span>
        </div>
        <div className="divider" />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{t('order.rate')}</dt>
          <dd className="tnum text-end font-medium">
            {formatToman(order.rateToman)} {t('common.toman')}
          </dd>
          <dt className="text-muted">{t('orderDetail.total')}</dt>
          <dd className="tnum text-end font-bold">
            {formatToman(order.totalToman)} {t('common.toman')}
          </dd>
          <dt className="text-muted">{t('orderDetail.officialRate')}</dt>
          <dd className="tnum text-end">{formatToman(official)}</dd>
          {order.buyerSavingToman > 0 ? (
            <>
              <dt className="text-muted">{t('orderDetail.saving')}</dt>
              <dd className="tnum text-end text-success">
                {formatToman(order.buyerSavingToman)} {t('common.toman')}
              </dd>
            </>
          ) : null}
          <dt className="text-muted">{t('orderDetail.delivery')}</dt>
          <dd className="text-end">{t('orderDetail.deliveryFuelCard')}</dd>
          <dt className="text-muted">{t('orderDetail.expiresAt')}</dt>
          <dd className="text-end tnum">{formatJalaliDateTime(order.expiresAt)}</dd>
        </dl>
        {order.note ? (
          <>
            <div className="divider" />
            <p className="text-sm">
              <span className="text-muted">{t('orderDetail.note')}: </span>
              {order.note}
            </p>
          </>
        ) : null}
      </div>

      <div className="mb-4 flex items-center justify-between rounded-sm bg-surface2 px-3 py-2 text-sm">
        <span className="text-muted">{t('orderDetail.owner')}</span>
        <span className="font-medium tnum" dir="ltr">
          {order.ownerId.slice(0, 8)}
        </span>
      </div>

      {mine ? (
        <Notice tone="warning">{t('orderDetail.mine')}</Notice>
      ) : order.status === 'OPEN' ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={busy}
          onClick={() => void reserve()}
        >
          {busy ? t('orderDetail.reserving') : t('orderDetail.reserve')}
        </button>
      ) : (
        <Notice tone="info">{t('errors.ORDER_NOT_AVAILABLE')}</Notice>
      )}
    </div>
  );
}
