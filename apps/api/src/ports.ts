import type {
  OrderSide,
  OrderStatus,
  ReservationStatus,
  Tier,
  UserRole,
  UserStatus,
} from '@benzin/shared';
import type {
  AuditEntry,
  DeviceRecord,
  Order,
  RefreshTokenRecord,
  Reservation,
  SettingsRecord,
  User,
} from './domain/entities.js';

export interface NewUser {
  phone: string;
  role?: UserRole;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  create(input: NewUser): Promise<User>;
  save(user: User): Promise<User>;
  list(limit: number): Promise<User[]>;
}

export interface OtpChallenge {
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sentAt: Date;
  consumedAt: Date | null;
}

export interface OtpRepository {
  findLatest(phone: string): Promise<OtpChallenge | null>;
  save(challenge: OtpChallenge): Promise<void>;
}

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  familyId: string;
  deviceId: string | null;
  expiresAt: Date;
}

export interface RefreshTokenRepository {
  create(input: NewRefreshToken): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marks one token as rotated/revoked; `replacedBy` links the successor. */
  revoke(id: string, replacedBy: string | null, at: Date): Promise<void>;
  /** Revokes every token of a rotation family — the response to a reuse detection. */
  revokeFamily(familyId: string, at: Date): Promise<number>;
  revokeAllForUser(userId: string, at: Date): Promise<number>;
  countActive(userId: string): Promise<number>;
}

export interface DeviceInput {
  userId: string;
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  pushToken?: string | null;
  appVersion?: string | null;
}

export interface DeviceRepository {
  upsert(input: DeviceInput, at: Date): Promise<DeviceRecord>;
  listByUser(userId: string): Promise<DeviceRecord[]>;
}

export interface NewOrder {
  ownerId: string;
  side: OrderSide;
  tier: Tier;
  litres: number;
  rateToman: number;
  zoneId: string;
  stationName: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  deliveryMethod: 'FUEL_CARD';
  expiresAt: Date;
}

export interface OrderSearchQuery {
  zoneId: string;
  side: OrderSide;
  tier: Tier;
  now: Date;
  limit: number;
  offset: number;
  sort: 'distance' | 'price' | 'newest';
  origin: { lat: number; lng: number } | null;
  radiusKm: number | null;
}

export interface OrderRepository {
  create(input: NewOrder): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  search(query: OrderSearchQuery): Promise<{ items: Order[]; total: number }>;
  listByOwner(ownerId: string, limit: number): Promise<Order[]>;
  countOpenByOwner(ownerId: string, now: Date): Promise<number>;
  /** Compare-and-set; returns null when the order is no longer in `expected`. */
  transition(
    id: string,
    expected: OrderStatus,
    next: OrderStatus,
    patch?: Partial<Pick<Order, 'updatedAt'>>,
  ): Promise<Order | null>;
  listExpired(now: Date, limit: number): Promise<Order[]>;
}

export interface NewReservation {
  id: string;
  orderId: string;
  takerId: string;
  expiresAt: Date;
}

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  findActiveByOrder(orderId: string): Promise<Reservation | null>;
  findActiveByTaker(takerId: string): Promise<Reservation[]>;
  countActiveByTaker(takerId: string): Promise<number>;
  listByTaker(takerId: string, limit: number): Promise<Reservation[]>;
  /**
   * Atomically inserts a reservation only if the order has no active reservation.
   * Backed by the partial unique index `reservations_one_active_per_order` in Postgres.
   */
  createExclusive(input: NewReservation): Promise<Reservation | null>;
  transition(
    id: string,
    expected: ReservationStatus,
    next: ReservationStatus,
    patch?: Partial<Pick<Reservation, 'decidedAt' | 'completedAt' | 'cancelReason'>>,
  ): Promise<Reservation | null>;
  listExpiredPending(now: Date, limit: number): Promise<Reservation[]>;
  listAll(limit: number): Promise<Reservation[]>;
}

export interface SettingsRepository {
  findAll(): Promise<SettingsRecord[]>;
  set(key: string, value: unknown, updatedBy: string | null): Promise<SettingsRecord>;
}

export interface AuditRepository {
  append(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry>;
  list(limit: number): Promise<AuditEntry[]>;
}

/** Outbound SMS port. Providers (Kavenegar/SMS.ir/…) are implemented in a later task. */
export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

export interface IdGenerator {
  (): string;
}

export interface Repositories {
  users: UserRepository;
  otps: OtpRepository;
  refreshTokens: RefreshTokenRepository;
  devices: DeviceRepository;
  orders: OrderRepository;
  reservations: ReservationRepository;
  settings: SettingsRepository;
  audit: AuditRepository;
}

export type { UserStatus };
