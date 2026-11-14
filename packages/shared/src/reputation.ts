/**
 * Trust and reputation rules (tasks E6-01…E6-03).
 *
 * The score is a projection of append-only reputation events, never a column that can be
 * edited by hand: `50 + Σ delta`, clamped to 0…100. Every rule below is referenced by the
 * API so a product decision changes one constant instead of scattered branches.
 */
export const REPUTATION_EVENT_KINDS = [
  'TRADE_COMPLETED',
  'TRADE_AUTO_COMPLETED',
  'TAKER_CANCELLED',
  'OWNER_CANCELLED',
  'DISPUTE_OPENED',
  'RATING_HIGH',
  'RATING_MID',
  'RATING_LOW',
  'REPORT_CONFIRMED',
  'SUSPENSION_LIFTED',
] as const;

export type ReputationEventKind = (typeof REPUTATION_EVENT_KINDS)[number];

/** Points added by each event. ASSUMPTION A22 fixes the numbers. */
export const REPUTATION_DELTAS: Record<ReputationEventKind, number> = {
  TRADE_COMPLETED: 5,
  TRADE_AUTO_COMPLETED: 2,
  TAKER_CANCELLED: -3,
  OWNER_CANCELLED: -2,
  DISPUTE_OPENED: 0,
  RATING_HIGH: 2,
  RATING_MID: 0,
  RATING_LOW: -2,
  REPORT_CONFIRMED: -10,
  SUSPENSION_LIFTED: 0,
};

export const REPUTATION_BASE_SCORE = 50;
export const REPUTATION_MIN_SCORE = 0;
export const REPUTATION_MAX_SCORE = 100;

export const REPUTATION_LEVELS = ['GOLD', 'SILVER', 'BRONZE'] as const;
export type ReputationLevel = (typeof REPUTATION_LEVELS)[number];

export const REPUTATION_LEVEL_FA: Record<ReputationLevel, string> = {
  GOLD: 'طلایی',
  SILVER: 'نقره‌ای',
  BRONZE: 'برنزی',
};

/** Gold from 80, silver from 50, bronze below. */
export function reputationLevel(score: number): ReputationLevel {
  if (score >= 80) return 'GOLD';
  if (score >= 50) return 'SILVER';
  return 'BRONZE';
}

const clamp = (value: number): number =>
  Math.min(REPUTATION_MAX_SCORE, Math.max(REPUTATION_MIN_SCORE, value));

/** Projects the event stream into the 0…100 score shown in the app. */
export function reputationScore(events: readonly { delta: number }[]): number {
  return clamp(REPUTATION_BASE_SCORE + events.reduce((sum, event) => sum + event.delta, 0));
}

/** 1–2 stars is a negative signal, 3 is neutral, 4–5 is positive (E6-03). */
export function ratingEventKind(stars: number): ReputationEventKind {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new RangeError('stars must be an integer between 1 and 5');
  }
  if (stars >= 4) return 'RATING_HIGH';
  if (stars === 3) return 'RATING_MID';
  return 'RATING_LOW';
}

/** Persian labels for the history screen; keeps copy out of components. */
export const REPUTATION_EVENT_FA: Record<ReputationEventKind, string> = {
  TRADE_COMPLETED: 'معامله‌ی موفق',
  TRADE_AUTO_COMPLETED: 'تکمیل خودکار معامله',
  TAKER_CANCELLED: 'لغو رزرو توسط خریدار',
  OWNER_CANCELLED: 'لغو رزرو توسط صاحب سفارش',
  DISPUTE_OPENED: 'اختلاف ثبت‌شده',
  RATING_HIGH: 'امتیاز مثبت هم‌معامله',
  RATING_MID: 'امتیاز متوسط هم‌معامله',
  RATING_LOW: 'امتیاز منفی هم‌معامله',
  REPORT_CONFIRMED: 'گزارش تخلف تأییدشده',
  SUSPENSION_LIFTED: 'پایان تعلیق حساب',
};

/** Rating is allowed only once the trade actually happened. */
export const RATEABLE_RESERVATION_STATUSES = ['COMPLETED', 'AUTO_COMPLETED'] as const;
