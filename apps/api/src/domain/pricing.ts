import { TIER_RATE_TOMAN, type Tier } from '@benzin/shared';

/** Total money that changes hands for an order (litres × agreed rate). */
export function orderTotalToman(litres: number, rateToman: number): number {
  return Math.round(litres * rateToman);
}

/** Worst-case saving for the buyer versus paying the official tier rate. */
export function buyerSavingToman(tier: Tier, litres: number, rateToman: number): number {
  return Math.round(litres * (TIER_RATE_TOMAN[tier] - rateToman));
}

/** True when the seller is asking more than the official rate for that tier. */
export function isAboveOfficialRate(tier: Tier, rateToman: number): boolean {
  return rateToman > TIER_RATE_TOMAN[tier];
}

/** True when the price is suspiciously low versus the official rate (§8 anti-abuse warning). */
export function isSuspiciouslyLow(
  tier: Tier,
  rateToman: number,
  tolerancePercent: number,
): boolean {
  const official = TIER_RATE_TOMAN[tier];
  return rateToman < official * (1 - tolerancePercent / 100);
}
