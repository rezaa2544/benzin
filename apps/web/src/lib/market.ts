import type { OrderSide, Tier } from '@benzin/shared';

export type SortKey = 'distance' | 'price' | 'newest';

export interface MarketFilters {
  zoneId: string;
  side: OrderSide;
  tier: Tier;
  sort: SortKey;
}

export const DEFAULT_FILTERS: MarketFilters = {
  zoneId: '',
  side: 'BUY',
  tier: 'T3000',
  sort: 'newest',
};

const SORTS: readonly SortKey[] = ['distance', 'price', 'newest'];

/** Reads filters from the URL so a shared link opens the same search. */
export function filtersFromQuery(
  query: Record<string, string>,
  fallback: MarketFilters = DEFAULT_FILTERS,
): MarketFilters {
  const side = query['side'] === 'SELL' || query['side'] === 'BUY' ? query['side'] : fallback.side;
  const tier = ['T1500', 'T3000', 'T10000'].includes(query['tier'] ?? '')
    ? (query['tier'] as Tier)
    : fallback.tier;
  const sort = SORTS.includes(query['sort'] as SortKey)
    ? (query['sort'] as SortKey)
    : fallback.sort;
  return { zoneId: query['zoneId'] ?? fallback.zoneId, side, tier, sort };
}

export const TIER_LABEL_FA: Record<Tier, string> = {
  T1500: 'آزاد ۱۵۰۰',
  T3000: 'آزاد ۳۰۰۰',
  T10000: 'آزاد ۱۰۰۰۰',
};

/** `distance` needs a point; without one the API rejects the request, so we fall back. */
export function effectiveSort(filters: MarketFilters, hasOrigin: boolean): SortKey {
  return filters.sort === 'distance' && !hasOrigin ? 'newest' : filters.sort;
}

/** Market search is a getter for the API query, ignoring the fields it does not accept. */
export function toSearchQuery(
  filters: MarketFilters,
  options: { cursor?: string; origin?: { lat: number; lng: number } | null; limit?: number } = {},
): Record<string, unknown> {
  const sort = effectiveSort(filters, Boolean(options.origin));
  return {
    zoneId: filters.zoneId,
    side: filters.side,
    tier: filters.tier,
    sort,
    limit: options.limit ?? 20,
    cursor: options.cursor,
    lat: options.origin?.lat,
    lng: options.origin?.lng,
  };
}
