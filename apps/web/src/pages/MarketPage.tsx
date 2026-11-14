import { useEffect, useMemo, useState } from 'react';
import {
  ORDER_SIDE_FA,
  formatToman,
  toPersianDigits,
  type OrderSide,
  type Tier,
} from '@benzin/shared';
import type { ApiClient } from '../lib/api.js';
import { errorMessage } from '../lib/api.js';
import type { MarketStats, MetaConfig, OrderList, OrderView, ZoneView } from '../lib/types.js';
import type { MarketFilters, SortKey } from '../lib/market.js';
import { TIER_LABEL_FA, toSearchQuery } from '../lib/market.js';
import { buildQuery, navigate } from '../lib/router.js';
import { t, tf } from '../lib/i18n.js';
import { OrderCard } from '../components/OrderCard.js';
import { EmptyState } from '../components/EmptyState.js';
import { Notice, PageTitle, Skeleton } from './parts.js';

export interface MarketPageProps {
  api: ApiClient;
  config: MetaConfig | null;
  zones: ZoneView[];
  filters: MarketFilters;
  onFilters: (next: MarketFilters) => void;
}

const errorMap = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  UNAUTHORIZED: t('errors.UNAUTHORIZED'),
  ZONE_NOT_SUPPORTED: t('errors.ZONE_NOT_SUPPORTED'),
  VALIDATION_ERROR: t('errors.VALIDATION_ERROR'),
};

const SIDES: readonly OrderSide[] = ['BUY', 'SELL'];
const TIERS: readonly Tier[] = ['T1500', 'T3000', 'T10000'];
const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'newest', label: t('market.sortNewest') },
  { key: 'price', label: t('market.sortPrice') },
  { key: 'distance', label: t('market.sortDistance') },
];

/**
 * Market list (E9-05/E9-06): filters live in the URL, a market-stat strip gives the price
 * context, and paging is cursor-based because the API never exposes offsets.
 */
export function MarketPage({
  api,
  config,
  zones,
  filters,
  onFilters,
}: MarketPageProps): JSX.Element {
  const [items, setItems] = useState<OrderView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MarketStats | null>(null);

  const activeZone = filters.zoneId || zones[0]?.id || '';
  const effective: MarketFilters = { ...filters, zoneId: activeZone };
  const zoneName = zones.find((zone) => zone.id === activeZone)?.nameFa ?? '';

  useEffect(() => {
    if (!filters.zoneId && zones[0]) onFilters({ ...filters, zoneId: zones[0].id });
  }, [zones.length]);

  useEffect(() => {
    if (!activeZone) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = toSearchQuery(effective);
    Promise.all([
      api.get<OrderList>('/v1/orders', query),
      api
        .get<MarketStats>('/v1/stats/market', {
          zoneId: activeZone,
          side: effective.side,
          tier: effective.tier,
        })
        .catch(() => null),
    ])
      .then(([list, marketStats]) => {
        if (cancelled) return;
        setItems(list.items);
        setCursor(list.nextCursor);
        setStats(marketStats);
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
  }, [activeZone, effective.side, effective.tier, effective.sort]);

  const apply = (patch: Partial<MarketFilters>): void => {
    const next = { ...effective, ...patch };
    onFilters(next);
    navigate(`/market${buildQuery({ ...next, zoneId: next.zoneId })}`, { replace: true });
  };

  const loadMore = async (): Promise<void> => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const list = await api.get<OrderList>('/v1/orders', toSearchQuery(effective, { cursor }));
      setItems((current) => [...current, ...list.items]);
      setCursor(list.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, errorMap));
    } finally {
      setLoadingMore(false);
    }
  };

  const median = useMemo(
    () => (stats?.medianRateToman ? formatToman(stats.medianRateToman) : null),
    [stats],
  );

  return (
    <div>
      <PageTitle title={t('market.title')} lead={t('market.lead')} />

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          aria-label={t('market.zone')}
          className="input max-w-[9rem] text-sm"
          value={activeZone}
          onChange={(event) => apply({ zoneId: event.target.value })}
        >
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.nameFa}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-sm border border-line">
          {SIDES.map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={effective.side === side}
              onClick={() => apply({ side })}
              className={`min-h-tap px-3 text-sm ${effective.side === side ? 'bg-brand text-brandInk' : 'bg-surface text-muted'}`}
            >
              {ORDER_SIDE_FA[side]}
            </button>
          ))}
        </div>
        <select
          aria-label={t('market.sort')}
          className="input max-w-[8rem] text-sm"
          value={effective.sort}
          onChange={(event) => apply({ sort: event.target.value as SortKey })}
        >
          {SORTS.map((sort) => (
            <option key={sort.key} value={sort.key}>
              {sort.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => apply({ tier })}
            aria-pressed={effective.tier === tier}
            className={`chip min-h-tap ${effective.tier === tier ? 'bg-brandSoft text-brand' : ''}`}
          >
            {TIER_LABEL_FA[tier]}
          </button>
        ))}
      </div>

      {stats && stats.sampleSize > 0 ? (
        <div className="card mb-4 flex items-center justify-between gap-3 py-3">
          <span className="text-xs text-muted">{t('market.median')}</span>
          <span className="money text-base">{median ? `${median} ${t('common.toman')}` : '—'}</span>
          <span className="text-xs text-muted tnum">
            {tf('market.sample', {
              count: toPersianDigits(stats.sampleSize),
              days: toPersianDigits(stats.windowDays),
            })}
          </span>
        </div>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading ? <Skeleton rows={3} /> : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState title={t('market.empty')} body={t('market.emptyBody')} icon="search" />
      ) : null}

      <div className="flex flex-col gap-3">
        {items.map((order) => (
          <OrderCard
            key={order.id}
            side={order.side}
            status={order.status}
            litres={order.litres}
            rateToman={order.rateToman}
            zoneName={order.stationName ?? zoneName}
            distanceKm={order.distance?.distanceKm}
            expiresAt={order.expiresAt}
            onOpen={() => navigate(`/market/${order.id}`)}
          />
        ))}
      </div>

      {cursor ? (
        <button
          type="button"
          className="btn mt-4 w-full"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? t('market.loadingMore') : t('market.loadMore')}
        </button>
      ) : null}

      {config ? (
        <p className="mt-4 text-center text-xs text-muted">
          {tf('create.litresHint', {
            min: toPersianDigits(config.minLitres),
            max: toPersianDigits(config.maxLitres),
          })}
        </p>
      ) : null}
    </div>
  );
}
