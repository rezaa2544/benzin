import { z } from 'zod';

/**
 * Runtime settings (§7 of the brief). Every key has a documented default so the platform
 * is fully operable out of the box; the admin panel edits these rows at runtime.
 * Values marked ASSUMPTION were not fixed by the brief and are recorded in docs/ASSUMPTIONS.md.
 */
export const SETTING_DEFINITIONS = {
  'reservation.ttl_minutes': { schema: z.number().int().min(1).max(120), default: 10 },
  'reservation.max_active_per_user': { schema: z.number().int().min(1).max(10), default: 1 },
  'reservation.contact_window_minutes': { schema: z.number().int().min(1).max(240), default: 45 },
  'owner.decision_ttl_minutes': { schema: z.number().int().min(1).max(120), default: 5 },
  'order.max_open_per_user': { schema: z.number().int().min(1).max(10), default: 2 },
  'order.min_litres': { schema: z.number().min(0.1).max(1000), default: 5 },
  'order.max_litres': { schema: z.number().min(1).max(1000), default: 60 },
  'order.default_expiry_hours': { schema: z.number().int().min(1).max(168), default: 24 },
  'order.rate_ceiling_tolerance_percent': { schema: z.number().min(0).max(100), default: 20 },
  'trade.auto_complete_hours': { schema: z.number().int().min(1).max(72), default: 2 },
  'chat.max_message_length': { schema: z.number().int().min(20).max(2000), default: 500 },
  'notification.sms_enabled': { schema: z.boolean(), default: true },
  'chat.quick_replies': {
    schema: z.array(z.string().min(1).max(120)).min(1).max(12),
    default: ['سلام، در مسیرم', '۵ دقیقه دیگر می‌رسم', 'پمپ شلوغ است', 'کارت را آماده کنید'],
  },
  'otp.length': { schema: z.literal(5), default: 5 },
  'otp.ttl_seconds': { schema: z.number().int().min(30).max(600), default: 120 },
  'otp.max_attempts': { schema: z.number().int().min(1).max(10), default: 5 },
  'otp.resend_cooldown_seconds': { schema: z.number().int().min(15).max(600), default: 60 },
  'auth.refresh_token_days': { schema: z.number().int().min(1).max(365), default: 30 },
  'pricing.low_price_warning_percent': { schema: z.number().min(0).max(90), default: 30 },
  'dispute.auto_review_hours': { schema: z.number().int().min(1).max(168), default: 24 },
  'geo.default_radius_km': { schema: z.number().min(1).max(200), default: 15 },
  'subscription.required_for_orders': { schema: z.boolean(), default: false },
  'payment.card_to_card_ttl_minutes': { schema: z.number().int().min(15).max(1440), default: 120 },
  'payment.gateway_ttl_minutes': { schema: z.number().int().min(5).max(180), default: 30 },
  'payment.unique_suffix_max': { schema: z.number().int().min(1).max(999), default: 999 },
  'trust.suspend_below_score': { schema: z.number().int().min(0).max(99), default: 20 },
  'trust.suspend_hours': { schema: z.number().int().min(1).max(720), default: 24 },
  'trust.window_days': { schema: z.number().int().min(1).max(365), default: 180 },
  'stats.window_days': { schema: z.number().int().min(1).max(365), default: 30 },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export type Settings = { [K in SettingKey]: SettingValue<K> };

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_KEYS.map((key) => [key, SETTING_DEFINITIONS[key].default]),
) as unknown as Settings;

/** Validates and coerces a single value; throws a ZodError when the value is out of contract. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  return SETTING_DEFINITIONS[key].schema.parse(raw) as SettingValue<K>;
}

/** Applies a partial map of overrides on top of a base settings object. */
export function withOverrides(
  base: Settings,
  overrides: Partial<Record<SettingKey, unknown>>,
): Settings {
  const next: Settings = { ...base };
  for (const [key, raw] of Object.entries(overrides)) {
    if (!(key in SETTING_DEFINITIONS)) throw new RangeError(`Unknown setting: ${key}`);
    (next as Record<string, unknown>)[key] = parseSetting(key as SettingKey, raw);
  }
  return next;
}
