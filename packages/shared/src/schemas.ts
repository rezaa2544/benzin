import { z } from 'zod';
import {
  CANCEL_REASONS,
  DELIVERY_METHODS,
  ORDER_SIDES,
  ORDER_STATUSES,
  SUBSCRIPTION_STATUSES,
  TIERS,
  USER_ROLES,
  USER_STATUSES,
} from './enums.js';
import { toAsciiDigits } from './format.js';

/** Iranian mobile number, normalised to 09XXXXXXXXX. Accepts Persian digits, +98 and 0098. */
export const iranMobileSchema = z
  .string()
  .trim()
  .transform((value) => toAsciiDigits(value).replace(/[\s-]/g, ''))
  .transform((value) => {
    if (value.startsWith('+98')) return `0${value.slice(3)}`;
    if (value.startsWith('0098')) return `0${value.slice(4)}`;
    if (value.startsWith('98') && value.length === 12) return `0${value.slice(2)}`;
    return value;
  })
  .pipe(z.string().regex(/^09\d{9}$/, { message: 'PHONE_INVALID' }));

export type IranMobile = z.infer<typeof iranMobileSchema>;

export const otpCodeSchema = z
  .string()
  .trim()
  .transform(toAsciiDigits)
  .pipe(z.string().regex(/^\d{5}$/, { message: 'OTP_INVALID' }));

export const requestOtpSchema = z.object({ phone: iranMobileSchema }).strict();

export const verifyOtpSchema = z
  .object({
    phone: iranMobileSchema,
    code: otpCodeSchema,
    device: z
      .object({
        platform: z.enum(['android', 'ios', 'web']),
        deviceId: z.string().min(8).max(128),
        pushToken: z.string().max(512).optional(),
        appVersion: z.string().max(32).optional(),
      })
      .optional(),
  })
  .strict();

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(20).max(512) }).strict();

const litresSchema = z
  .number()
  .positive()
  .refine((v) => Math.round(v * 100) === v * 100, { message: 'LITRES_PRECISION' });

export const createOrderSchema = z
  .object({
    side: z.enum(ORDER_SIDES),
    tier: z.enum(TIERS),
    litres: litresSchema,
    rateToman: z.number().int().positive(),
    zoneId: z.string().uuid(),
    stationName: z.string().trim().min(2).max(80).optional(),
    note: z.string().trim().max(240).optional(),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict()
      .optional(),
    deliveryMethod: z.enum(DELIVERY_METHODS).default('FUEL_CARD'),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Owner-side edit of an open order. Every field is optional, but at least one is required. */
export const updateOrderSchema = z
  .object({
    litres: litresSchema.optional(),
    rateToman: z.number().int().positive().optional(),
    stationName: z.string().trim().min(2).max(80).nullable().optional(),
    note: z.string().trim().max(240).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const marketStatsSchema = z
  .object({
    zoneId: z.string().uuid(),
    side: z.enum(ORDER_SIDES),
    tier: z.enum(TIERS),
  })
  .strict();

export type MarketStatsInput = z.infer<typeof marketStatsSchema>;

export const orderSearchSchema = z
  .object({
    zoneId: z.string().uuid(),
    side: z.enum(ORDER_SIDES),
    tier: z.enum(TIERS),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(0.5).max(200).optional(),
    sort: z.enum(['distance', 'price', 'newest']).default('distance'),
    cursor: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type OrderSearchInput = z.infer<typeof orderSearchSchema>;

/** Optional "where am I" pair. Both coordinates or neither — never just one. */
export const originQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'lat and lng must be sent together',
    path: ['lng'],
  });

export type OriginQuery = z.infer<typeof originQuerySchema>;

export const cancelReservationSchema = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    note: z.string().trim().max(240).optional(),
  })
  .strict();

/**
 * Chat message. The hard cap is 2000 characters; the effective limit comes from the
 * runtime setting `chat.max_message_length` and is enforced by ChatService (task E5-01).
 */
export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    clientMessageId: z.string().uuid().optional(),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Incremental read: everything strictly newer than `after` (an ISO timestamp). */
export const chatMessagesQuerySchema = z
  .object({
    after: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type ChatMessagesQuery = z.infer<typeof chatMessagesQuerySchema>;

/** Plan purchase. `method` picks the provider (E7-02). */
export const purchaseSubscriptionSchema = z
  .object({
    planCode: z.string().trim().min(2).max(32),
    method: z.enum(['CARD_TO_CARD', 'GATEWAY']).default('CARD_TO_CARD'),
  })
  .strict();

export type PurchaseSubscriptionInput = z.infer<typeof purchaseSubscriptionSchema>;

export const gatewayCallbackSchema = z
  .object({
    authority: z.string().trim().min(4).max(128).optional(),
    reference: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export type GatewayCallbackInput = z.infer<typeof gatewayCallbackSchema>;

export const confirmPaymentSchema = z
  .object({
    reference: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const rejectPaymentSchema = z
  .object({
    reason: z.string().trim().min(3).max(240),
  })
  .strict();

export const paymentListSchema = z
  .object({
    status: z.enum(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const createPaymentCardSchema = z
  .object({
    cardNumber: z
      .string()
      .trim()
      .transform(toAsciiDigits)
      .pipe(z.string().regex(/^\d{16}$/, { message: 'CARD_NUMBER_INVALID' })),
    holderName: z.string().trim().min(2).max(80),
    bankName: z.string().trim().min(2).max(40).optional(),
    dailyLimit: z.number().int().positive().optional(),
  })
  .strict();

export type CreatePaymentCardInput = z.infer<typeof createPaymentCardSchema>;

/** Quick post-trade rating (task E6-03). Stars are mandatory, the note is optional. */
export const ratingSchema = z
  .object({
    stars: z.number().int().min(1).max(5),
    comment: z.string().trim().max(240).optional(),
  })
  .strict();

export type RatingInput = z.infer<typeof ratingSchema>;

export const notificationQuerySchema = z
  .object({
    unreadOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const zoneLocateSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  })
  .strict();

export type ZoneLocateInput = z.infer<typeof zoneLocateSchema>;

export const paginationSchema = z
  .object({
    cursor: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Formats a ZodError into `{ field: code }` for the API error envelope. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    result[key] ??= issue.message;
  }
  return result;
}

// ------------------------------------------------------------------ admin (E8)

const adminPaging = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
};

export const adminUserQuerySchema = z
  .object({
    q: z.string().trim().max(64).optional(),
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    ...adminPaging,
  })
  .strict();

export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

/** Role changes, profile edits and manual suspensions, all audited (task E8-02). */
/** Self-service profile (task E1-05). The display name is the only editable field in v1;
 *  the phone is the identity and changes only by verifying a new number with OTP. */
export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .nullable()
      .refine((value) => value === null || !/^[\d\s+\-()]+$/.test(value), {
        message: 'DISPLAY_NAME_INVALID',
      }),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const adminUpdateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    displayName: z.string().trim().min(2).max(60).nullable().optional(),
    status: z.enum(USER_STATUSES).optional(),
    suspendHours: z.number().int().min(1).max(720).optional(),
    reason: z.string().trim().min(3).max(240).optional(),
  })
  .strict()
  .refine((value) => value.status !== 'SUSPENDED' || value.suspendHours !== undefined, {
    message: 'SUSPEND_HOURS_REQUIRED',
    path: ['suspendHours'],
  });

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const adminOrderQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    zoneId: z.string().uuid().optional(),
    side: z.enum(ORDER_SIDES).optional(),
    q: z.string().trim().max(64).optional(),
    ...adminPaging,
  })
  .strict();

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

/** Only an admin closes a disputed trade (E4-04 / E8-03). */
export const adminResolveDisputeSchema = z
  .object({
    outcome: z.enum(['COMPLETE', 'CANCEL']),
    note: z.string().trim().min(3).max(240),
  })
  .strict();

export type AdminResolveDisputeInput = z.infer<typeof adminResolveDisputeSchema>;

export const adminSubscriptionQuerySchema = z
  .object({
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    ...adminPaging,
  })
  .strict();

export type AdminSubscriptionQuery = z.infer<typeof adminSubscriptionQuerySchema>;

export const adminAuditQuerySchema = z
  .object({
    action: z.string().trim().max(64).optional(),
    actorId: z.string().uuid().optional(),
    entity: z
      .enum([
        'user',
        'order',
        'reservation',
        'payment',
        'subscription',
        'zone',
        'provider',
        'settings',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(20_000).default(0),
  })
  .strict();

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

/** Cities are polygons in GeoJSON order `[lng, lat]` (task E8-07). */
export const zoneUpsertSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9-]+$/, { message: 'SLUG_INVALID' }),
    nameFa: z.string().trim().min(2).max(60),
    city: z.string().trim().min(2).max(60),
    province: z.string().trim().min(2).max(60),
    isActive: z.boolean().default(true),
    boundary: z
      .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
      .min(3)
      .max(200),
  })
  .strict();

export type ZoneUpsertInput = z.infer<typeof zoneUpsertSchema>;

/** SMS/gateway/map providers configured from the panel (task E8-06). */
export const providerSettingSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9.-]+$/, { message: 'PROVIDER_INVALID' }),
    kind: z.enum(['SMS', 'PAYMENT', 'MAP']),
    isActive: z.boolean().default(false),
    config: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  })
  .strict();

export type ProviderSettingInput = z.infer<typeof providerSettingSchema>;

export const providerTestSchema = z.object({ phone: iranMobileSchema }).strict();

export type ProviderTestInput = z.infer<typeof providerTestSchema>;

/** One-command owner bootstrap (task E8-10). */
export const createOwnerSchema = z
  .object({
    phone: iranMobileSchema,
    displayName: z.string().trim().min(2).max(60).default('مالک بنزین'),
  })
  .strict();

export type CreateOwnerInput = z.infer<typeof createOwnerSchema>;
