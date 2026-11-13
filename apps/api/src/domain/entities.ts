import type {
  DeliveryMethod,
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

export interface SettingsRecord {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string | null;
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
