import { useCallback, useState } from 'react';
import { RESERVATION_STATUS_FA, formatJalaliDate } from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { OrderView, ReservationView } from '../lib/types.js';
import { navigate } from '../lib/router.js';
import { useResource } from '../lib/useResource.js';
import { t } from '../lib/i18n.js';
import { OrderCard } from '../components/OrderCard.js';
import { EmptyState } from '../components/EmptyState.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface MyOrdersPageProps {
  api: ApiClient;
}

type Tab = 'orders' | 'reservations';

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  UNAUTHORIZED: t('errors.UNAUTHORIZED'),
};

/** My listings and my reservations in one screen (E9-11), the two entry points to a trade. */
export function MyOrdersPage({ api }: MyOrdersPageProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('orders');

  const loadOrders = useCallback(
    () => api.get<{ items: OrderView[] }>('/v1/orders/mine', { limit: 20 }),
    [api],
  );
  const loadReservations = useCallback(
    () => api.get<{ items: ReservationView[] }>('/v1/reservations/mine', { limit: 20 }),
    [api],
  );

  const orders = useResource(loadOrders, [tab, api]);
  const reservations = useResource(loadReservations, [tab, api]);

  return (
    <div>
      <PageTitle title={t('myOrders.title')} />

      <div className="mb-4 flex overflow-hidden rounded-sm border border-line">
        {(['orders', 'reservations'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-tap flex-1 text-sm ${tab === key ? 'bg-brand text-brandInk' : 'bg-surface text-muted'}`}
          >
            {key === 'orders' ? t('myOrders.tabOrders') : t('myOrders.tabReservations')}
          </button>
        ))}
      </div>

      {tab === 'orders' ? (
        orders.loading ? (
          <Skeleton rows={3} />
        ) : orders.error ? (
          <Notice tone="error">{errorMessage(orders.error, errorMap)}</Notice>
        ) : (orders.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={t('myOrders.emptyOrders')}
            body={t('myOrders.emptyOrdersBody')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => navigate('/new')}>
                {t('empty.action')}
              </button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {orders.data?.items.map((order) => (
              <OrderCard
                key={order.id}
                side={order.side}
                status={order.status}
                litres={order.litres}
                rateToman={order.rateToman}
                zoneName={order.stationName ?? undefined}
                expiresAt={order.expiresAt}
                onOpen={() => navigate(`/market/${order.id}`)}
              />
            ))}
          </div>
        )
      ) : reservations.loading ? (
        <Skeleton rows={3} />
      ) : reservations.error ? (
        <Notice tone="error">{errorMessage(reservations.error, errorMap)}</Notice>
      ) : (reservations.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={t('myOrders.emptyReservations')}
          body={t('myOrders.emptyReservationsBody')}
          icon="search"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {reservations.data?.items.map((reservation) => (
            <button
              key={reservation.id}
              type="button"
              onClick={() => navigate(`/trade/${reservation.id}`)}
              className="card flex items-center justify-between gap-3 text-start"
            >
              <div>
                <span className="chip mb-1">{RESERVATION_STATUS_FA[reservation.status]}</span>
                <p className="text-xs text-muted tnum">{formatJalaliDate(reservation.createdAt)}</p>
              </div>
              <span className="text-sm font-medium text-brand">{t('myOrders.openTrade')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
