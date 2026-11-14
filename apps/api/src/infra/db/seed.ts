import { DEFAULT_SETTINGS, SETTING_KEYS } from '@benzin/shared';
import type { ZoneRecord } from '../../domain/entities.js';
import type { Repositories } from '../../ports.js';

/**
 * Seed data (task E1-02). Idempotent: running it twice must not duplicate anything.
 * The Baneh polygon is an approximation of the city limits (ASSUMPTION A8) — the real
 * boundary is replaced from the admin panel once the mayor's GIS data is available.
 */

export const BANEH_ZONE: ZoneRecord = {
  id: '2b1f8f6e-9f1a-4c1b-9d0e-7a1c2b3d4e5f',
  slug: 'baneh',
  nameFa: 'بانه',
  city: 'بانه',
  province: 'کردستان',
  isActive: true,
  boundary: [
    [45.83, 35.96],
    [45.9, 35.955],
    [45.96, 35.99],
    [45.95, 36.05],
    [45.87, 36.07],
    [45.82, 36.02],
  ],
};

export const SEED_ZONES: readonly ZoneRecord[] = [BANEH_ZONE];

export interface SeedPlan {
  code: string;
  nameFa: string;
  durationDays: number;
  priceToman: number;
  maxActiveOrders: number;
  isActive: boolean;
}

export const SEED_PLANS: readonly SeedPlan[] = [
  {
    code: 'monthly',
    nameFa: 'اشتراک یک‌ماهه',
    durationDays: 30,
    priceToman: 49_000,
    maxActiveOrders: 3,
    isActive: true,
  },
  {
    code: 'quarterly',
    nameFa: 'اشتراک سه‌ماهه',
    durationDays: 90,
    priceToman: 129_000,
    maxActiveOrders: 5,
    isActive: true,
  },
];

export const SEED_SETTINGS: Record<string, unknown> = Object.fromEntries(
  SETTING_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]),
);

/** Applies the seed to any repository set (memory today, Postgres in the CLI path). */
/** Stable ids keep re-seeding idempotent across restarts (dev memory store and Postgres). */
export const SEED_PLAN_IDS: Record<string, string> = {
  monthly: '3d1c7c1a-1f6f-4d3e-9f0a-0b7b1c2d3e4f',
  quarterly: '3d1c7c1a-1f6f-4d3e-9f0a-0b7b1c2d3e50',
};

/** Destination card for manual card-to-card transfers (task E7-04); replaced in the panel. */
export const SEED_PAYMENT_CARD = {
  id: '3d1c7c1a-1f6f-4d3e-9f0a-0b7b1c2d3e51',
  cardNumber: '6037991234567890',
  holderName: 'شرکت بنزین',
  bankName: 'بانک ملی',
  dailyLimit: null,
} as const;

export async function applySeed(
  repos: Pick<Repositories, 'zones' | 'settings' | 'plans' | 'paymentCards'>,
): Promise<void> {
  for (const zone of SEED_ZONES) await repos.zones.upsert(zone);
  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await repos.settings.set(key, value, null);
  }
  for (const plan of SEED_PLANS) {
    await repos.plans.upsert({
      id: SEED_PLAN_IDS[plan.code] ?? plan.code,
      ...plan,
    });
  }
  const cards = await repos.paymentCards.list(false);
  if (cards.length === 0) {
    await repos.paymentCards.create(
      {
        cardNumber: SEED_PAYMENT_CARD.cardNumber,
        holderName: SEED_PAYMENT_CARD.holderName,
        bankName: SEED_PAYMENT_CARD.bankName,
        dailyLimit: SEED_PAYMENT_CARD.dailyLimit,
      },
      new Date(),
    );
  }
}
