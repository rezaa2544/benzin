/** Domain vocabulary shared by API, clients, and admin. Keep values stable: they are persisted. */

export const TIERS = ['T1500', 'T3000', 'T10000'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_RATE_TOMAN: Record<Tier, number> = { T1500: 1500, T3000: 3000, T10000: 10000 };

export const ORDER_SIDES = ['SELL', 'BUY'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_STATUSES = [
  'OPEN',
  'RESERVED',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'AWAITING_OWNER_DECISION',
  'DISPUTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const RESERVATION_STATUSES = [
  'PENDING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'AUTO_COMPLETED',
  'DISPUTED',
  'EXPIRED',
  'CANCELLED_BY_TAKER',
  'CANCELLED_BY_OWNER',
  'REJECTED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'PENDING_OWNER',
  'CONFIRMED',
];

export const CANCEL_REASONS = ['OWNER_UNRESPONSIVE', 'CHANGED_MIND', 'NO_SHOW', 'OTHER'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const DELIVERY_METHODS = ['FUEL_CARD'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const USER_ROLES = ['USER', 'SUPPORT', 'ADMIN', 'OWNER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Chat messages: free text, a deliberate contact card, or a system line. */
export const MESSAGE_KINDS = ['TEXT', 'CONTACT', 'SYSTEM'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'SMS', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const PAYMENT_PROVIDERS = ['CARD_TO_CARD', 'GATEWAY'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'NEEDS_REVIEW'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
