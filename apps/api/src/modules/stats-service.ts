import { TIER_RATE_TOMAN, type OrderSide, type Tier } from '@benzin/shared';
import { mean, median, percentile } from '../domain/stats.js';
import type { Clock } from '../domain/entities.js';
import type { Repositories } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface MarketStats {
  zoneId: string;
  side: OrderSide;
  tier: Tier;
  windowDays: number;
  /** Orders in the tier after removing suspicious prices. */
  sampleSize: number;
  /** Orders left out of the tier figures because their price looks like noise. */
  excludedSuspicious: number;
  medianRateToman: number | null;
  p25RateToman: number | null;
  p75RateToman: number | null;
  minRateToman: number | null;
  maxRateToman: number | null;
  /** Blended figure over every order of the window, suspicious ones included (E3-06). */
  overallAverageRateToman: number | null;
  overallSampleSize: number;
  generatedAt: string;
}

/** Hard cap so a busy zone cannot turn one stats call into a table scan. */
const MAX_SAMPLE = 5_000;

/**
 * Market rates for one zone/side/tier. Prices that sit far below the official rate are
 * treated as mistyped listings: they are counted and reported, but they never move the
 * median a buyer sees. The window comes from settings, not from the request.
 */
export class StatsService {
  constructor(
    private readonly repos: Pick<Repositories, 'orders'>,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async market(input: { zoneId: string; side: OrderSide; tier: Tier }): Promise<MarketStats> {
    const config = await this.settings.get();
    const windowDays = config['stats.window_days'];
    const now = this.clock.now();
    const since = new Date(now.getTime() - windowDays * 86_400_000);

    const orders = await this.repos.orders.listSince(input.zoneId, since, MAX_SAMPLE);
    const inTier = orders.filter((order) => order.side === input.side && order.tier === input.tier);

    const floor = TIER_RATE_TOMAN[input.tier] * (config['pricing.low_price_warning_percent'] / 100);
    const usable = inTier.filter((order) => order.rateToman >= floor);
    const rates = usable.map((order) => order.rateToman);
    const allRates = orders.map((order) => order.rateToman);

    return {
      zoneId: input.zoneId,
      side: input.side,
      tier: input.tier,
      windowDays,
      sampleSize: rates.length,
      excludedSuspicious: inTier.length - rates.length,
      medianRateToman: median(rates),
      p25RateToman: percentile(rates, 25),
      p75RateToman: percentile(rates, 75),
      minRateToman: rates.length > 0 ? Math.min(...rates) : null,
      maxRateToman: rates.length > 0 ? Math.max(...rates) : null,
      overallAverageRateToman: mean(allRates),
      overallSampleSize: allRates.length,
      generatedAt: now.toISOString(),
    };
  }
}
