import { useCallback, useState } from 'react';
import {
  RESERVATION_STATUS_FA,
  formatJalaliDateTime,
  formatToman,
  toPersianDigits,
} from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { MetaConfig, OrderView, PublicUser, ReservationView } from '../lib/types.js';
import { countdownWindow, tradeActions, tradeRole, type TradeAction } from '../lib/trade.js';
import { useNow, useResource } from '../lib/useResource.js';
import { navigate } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { CountdownRing } from '../components/CountdownRing.js';
import { ConfirmSheet } from '../components/ConfirmSheet.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface TradePageProps {
  api: ApiClient;
  user: PublicUser;
  config: MetaConfig | null;
  reservationId: string;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  RESERVATION_NOT_ACTIVE: t('errors.RESERVATION_NOT_ACTIVE'),
  NOT_RESERVATION_PARTY: t('errors.NOT_RESERVATION_PARTY'),
  NOT_ORDER_OWNER: t('errors.NOT_ORDER_OWNER'),
  INVALID_STATE_TRANSITION: t('errors.INVALID_STATE_TRANSITION'),
  CONTACT_SHARING_BLOCKED: t('errors.CONTACT_SHARING_BLOCKED'),
  ALREADY_DECIDED: t('errors.ALREADY_DECIDED'),
};

const LABELS: Record<TradeAction, string> = {
  confirm: t('trade.confirm'),
  reject: t('trade.reject'),
  complete: t('trade.complete'),
  dispute: t('trade.dispute'),
  cancel: t('trade.cancel'),
  contact: t('trade.contact'),
  rate: t('trade.rate'),
};

const DANGER: readonly TradeAction[] = ['reject', 'cancel', 'dispute'];

/** What `/v1/reservations/:id/contact` returns: both numbers, the caller picks the peer. */
interface ContactReveal {
  reservationId: string;
  orderId: string;
  revealedAt: string;
  owner: { id: string; phone: string };
  taker: { id: string; phone: string };
}

/**
 * Active trade screen (E9-09): state, countdown and exactly the actions the current role is
 * allowed to take. Contact reveal is a separate API call, never part of the public order.
 */
export function TradePage({ api, user, config, reservationId }: TradePageProps): JSX.Element {
  const now = useNow();
  const [pending, setPending] = useState<TradeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [stars, setStars] = useState(5);
  const [rated, setRated] = useState(false);

  const load = useCallback(async () => {
    const reservation = await api.get<ReservationView>(`/v1/reservations/${reservationId}`);
    const order = await api.get<OrderView>(`/v1/orders/${reservation.orderId}`);
    return { reservation, order };
  }, [api, reservationId]);

  const { data, error: loadError, loading, reload } = useResource(load, [api, reservationId]);

  const call = async (action: TradeAction): Promise<void> => {
    setPending(null);
    setError(null);
    setBusy(true);
    try {
      if (action === 'contact') {
        const result = await api.get<ContactReveal>(`/v1/reservations/${reservationId}/contact`);
        // Show the other party, never your own number.
        const isTaker = data?.reservation.takerId === user.id;
        setPhone(isTaker ? result.owner.phone : result.taker.phone);
      } else {
        await api.post(
          `/v1/reservations/${reservationId}/${action}`,
          action === 'cancel' ? {} : undefined,
        );
        reload();
      }
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async (): Promise<void> => {
    setRateOpen(false);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/reservations/${reservationId}/rating`, { stars });
      setRated(true);
      reload();
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={3} />;
  if (!data) {
    return (
      <div>
        <PageTitle title={t('trade.title')} />
        <Notice tone="error">{errorMessage(loadError, errorMap)}</Notice>
      </div>
    );
  }

  const { reservation, order } = data;
  const role = tradeRole(reservation, user.id, order.ownerId);
  const actions = tradeActions(reservation, role);
  const countdown = countdownWindow(reservation, config?.ownerDecisionTtlMinutes ?? 5, now);
  const live = reservation.status === 'PENDING_OWNER' || reservation.status === 'CONFIRMED';

  return (
    <div>
      <PageTitle
        title={t('trade.title')}
        lead={
          role === 'owner' ? t('trade.roleOwner') : role === 'taker' ? t('trade.roleTaker') : ''
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card mb-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="chip">{RESERVATION_STATUS_FA[reservation.status]}</span>
          <span className="text-xs text-muted tnum">
            {formatJalaliDateTime(reservation.createdAt)}
          </span>
        </div>
        {live ? (
          <CountdownRing
            remainingMs={countdown.remainingMs}
            totalMs={countdown.totalMs}
            label={
              reservation.status === 'PENDING_OWNER'
                ? t('trade.confirmTitle')
                : t('order.countdown')
            }
          />
        ) : null}
        <div className="divider" />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{t('order.litres')}</dt>
          <dd className="tnum text-end">{toPersianDigits(order.litres)}</dd>
          <dt className="text-muted">{t('order.rate')}</dt>
          <dd className="tnum text-end">{formatToman(order.rateToman)}</dd>
          <dt className="text-muted">{t('orderDetail.total')}</dt>
          <dd className="tnum text-end font-bold">{formatToman(order.totalToman)}</dd>
        </dl>
      </div>

      {phone ? (
        <Notice tone="success">
          <span dir="ltr" className="tnum font-bold">
            {phone}
          </span>
        </Notice>
      ) : null}

      {!phone && !actions.includes('contact') && live ? (
        <Notice tone="info">{t('trade.contactHidden')}</Notice>
      ) : null}

      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => {
              if (action === 'rate') setRateOpen(true);
              else if (DANGER.includes(action) || action === 'confirm' || action === 'complete')
                setPending(action);
              else void call(action);
            }}
            className={`btn w-full ${action === 'confirm' || action === 'complete' ? 'btn-primary' : ''} ${
              DANGER.includes(action) ? 'btn-danger' : ''
            }`}
          >
            {LABELS[action]}
          </button>
        ))}
        {actions.length === 0 && !live && !rated ? (
          <Notice tone="info">{t('trade.done')}</Notice>
        ) : null}
        {rated ? <Notice tone="success">{t('rate.done')}</Notice> : null}
      </div>

      <button
        type="button"
        className="btn btn-ghost mt-3 w-full"
        onClick={() => navigate(`/market/${order.id}`)}
      >
        {t('trade.orderLink')}
      </button>

      <ConfirmSheet
        open={rateOpen}
        title={t('rate.title')}
        body={t('rate.lead')}
        confirmLabel={t('rate.submit')}
        busy={busy}
        onConfirm={() => void submitRating()}
        onClose={() => setRateOpen(false)}
      >
        <div
          className="mb-3 flex justify-center gap-2"
          role="radiogroup"
          aria-label={t('rate.stars')}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={stars === value}
              aria-label={t('rate.star').replace('{count}', toPersianDigits(value))}
              onClick={() => setStars(value)}
              className={`min-h-tap min-w-tap rounded-sm text-2xl ${
                value <= stars ? 'text-accent' : 'text-muted'
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={pending !== null}
        title={pending ? titleFor(pending) : ''}
        body={pending ? bodyFor(pending) : undefined}
        confirmLabel={pending ? LABELS[pending] : undefined}
        tone={pending && DANGER.includes(pending) ? 'danger' : 'default'}
        busy={busy}
        onConfirm={() => (pending ? void call(pending) : undefined)}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

const titleFor = (action: TradeAction): string =>
  action === 'confirm'
    ? t('trade.confirmTitle')
    : action === 'reject'
      ? t('trade.rejectTitle')
      : action === 'dispute'
        ? t('trade.disputeTitle')
        : action === 'cancel'
          ? t('trade.cancelTitle')
          : t('trade.complete');

const bodyFor = (action: TradeAction): string | undefined =>
  action === 'confirm'
    ? t('trade.confirmBody')
    : action === 'reject'
      ? t('trade.rejectBody')
      : action === 'dispute'
        ? t('trade.disputeBody')
        : action === 'cancel'
          ? t('trade.cancelBody')
          : undefined;
