import { z } from 'zod';
import { CANCEL_REASONS, DELIVERY_METHODS, ORDER_SIDES, TIERS } from './enums.js';
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

export const cancelReservationSchema = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    note: z.string().trim().max(240).optional(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(500),
    clientMessageId: z.string().uuid().optional(),
  })
  .strict();

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
