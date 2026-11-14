import type {
  DeliveryMethod,
  PaymentMethod,
  PaymentStatus,
  SubscriptionStatus,
  ReputationEventKind,
  MessageKind,
  NotificationChannel,
  NotificationKind,
  OrderSide,
  OrderStatus,
  ReservationStatus,
  Tier,
  UserRole,
  UserStatus,
} from '@benzin/shared';

export interface User {
  readonly id: string;
  readonly phone: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  /** Set while a trust-score suspension is in force; cleared by the scheduler (E6-01). */
  suspendedUntil: Date | null;
  readonly createdAt: Date;
}

export interface Order {
  readonly id: string;
  readonly ownerId: string;
  readonly side: OrderSide;
  readonly tier: Tier;
  readonly litres: number;
  readonly rateToman: number;
  readonly zoneId: string;
  readonly stationName: string | null;
  readonly note: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly deliveryMethod: DeliveryMethod;
  status: OrderStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface Reservation {
  readonly id: string;
  readonly orderId: string;
  readonly takerId: string;
  status: ReservationStatus;
  readonly createdAt: Date;
  /** Deadline for the order owner to accept the request. */
  readonly expiresAt: Date;
  decidedAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
}

/** One chat thread per order; both trade parties write into it (task E5-01). */
export interface Conversation {
  readonly id: string;
  readonly orderId: string;
  readonly createdAt: Date;
  closedAt: Date | null;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly kind: MessageKind;
  readonly body: string;
  readonly clientMessageId: string | null;
  readAt: Date | null;
  readonly createdAt: Date;
}

/** Sellable subscription plan (task E7-01). Prices are Toman, never Rial. */
export interface Plan {
  readonly id: string;
  readonly code: string;
  readonly nameFa: string;
  readonly durationDays: number;
  readonly priceToman: number;
  /** Extra open-order slots granted while the subscription is active. */
  readonly maxActiveOrders: number;
  readonly isActive: boolean;
}

export interface Subscription {
  readonly id: string;
  readonly userId: string;
  readonly planId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date;
  readonly createdAt: Date;
}

export interface Payment {
  readonly id: string;
  readonly userId: string;
  readonly subscriptionId: string | null;
  readonly provider: PaymentMethod;
  status: PaymentStatus;
  readonly amountToman: number;
  authority: string | null;
  reference: string | null;
  /** Card-to-card transfers are matched by this unique amount (E7-04). */
  readonly uniqueAmountToman: number | null;
  readonly rawPayload: Record<string, unknown>;
  paidAt: Date | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** Destination card shown to the payer; never returned raw (task E7-07). */
export interface PaymentCard {
  readonly id: string;
  readonly cardNumber: string;
  readonly holderName: string;
  readonly bankName: string | null;
  isActive: boolean;
  readonly dailyLimit: number | null;
  readonly createdAt: Date;
}

/** Append-only trust event; the score is always derived from these rows. */
export interface ReputationEvent {
  readonly id: string;
  readonly userId: string;
  readonly kind: ReputationEventKind;
  readonly delta: number;
  readonly orderId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

/** One quick rating left by a trade party for the other (task E6-03). */
export interface TradeRating {
  readonly id: string;
  readonly reservationId: string;
  readonly raterId: string;
  readonly subjectId: string;
  readonly stars: number;
  readonly comment: string | null;
  readonly createdAt: Date;
}

/** In-app inbox row. `kind` links back to the Persian template that rendered it. */
export interface NotificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly channel: NotificationChannel;
  readonly kind: NotificationKind;
  readonly titleFa: string;
  readonly bodyFa: string;
  readonly payload: Record<string, unknown>;
  readAt: Date | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

export interface ZoneRecord {
  readonly id: string;
  readonly slug: string;
  readonly nameFa: string;
  readonly city: string;
  readonly province: string;
  isActive: boolean;
  /** Exterior ring as [lng, lat] pairs (GeoJSON order). */
  readonly boundary: readonly (readonly [number, number])[];
}

export interface DeviceRecord {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  platform: 'android' | 'ios' | 'web';
  pushToken: string | null;
  appVersion: string | null;
  lastSeenAt: Date;
  readonly createdAt: Date;
}

/** One row per issued refresh token; rotation links the chain through `familyId`. */
export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly deviceId: string | null;
  readonly expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  readonly createdAt: Date;
}

export interface SettingsRecord {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Runtime provider configuration editable from the panel (task E8-06): SMS gateway,
 * payment gateway or map provider credentials and switches.
 */
export interface ProviderSetting {
  readonly id: string;
  provider: string;
  kind: 'SMS' | 'PAYMENT' | 'MAP';
  config: Record<string, unknown>;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface AuditEntry {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

/** Injected everywhere so time-dependent behaviour is deterministic in tests. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
