import type {
  MessageKind,
  ReputationEventKind,
  NotificationKind,
  OrderSide,
  OrderStatus,
  ReservationStatus,
  Tier,
  UserRole,
  UserStatus,
} from '@benzin/shared';
import type {
  AuditEntry,
  Conversation,
  ReputationEvent,
  TradeRating,
  DeviceRecord,
  Message,
  NotificationRecord,
  Order,
  RefreshTokenRecord,
  Reservation,
  SettingsRecord,
  User,
  ZoneRecord,
} from './domain/entities.js';

export interface NewUser {
  phone: string;
  role?: UserRole;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Suspended accounts whose window elapsed — the scheduler restores them (E6-01). */
  listSuspendedDue(now: Date, limit: number): Promise<User[]>;
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
  /** Owner-side field edit that keeps the order in its current state (task E3-04). */
  update(
    id: string,
    patch: Partial<Pick<Order, 'litres' | 'rateToman' | 'stationName' | 'note'>>,
    at: Date,
  ): Promise<Order | null>;
  /** All orders of a zone created since `since`, newest first — input for market stats. */
  listSince(zoneId: string, since: Date, limit: number): Promise<Order[]>;
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
  /** Every reservation of one order, newest first — chat access checks use this. */
  listByOrder(orderId: string, limit: number): Promise<Reservation[]>;
  listAll(limit: number): Promise<Reservation[]>;
}

export interface NewMessage {
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  clientMessageId: string | null;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findByOrder(orderId: string): Promise<Conversation | null>;
  /** Idempotent: one thread per order, created on first access. */
  ensureForOrder(orderId: string, at: Date): Promise<Conversation>;
  close(id: string, at: Date): Promise<Conversation | null>;
  /** Threads the user takes part in, most recently active first. */
  listByParticipant(userId: string, limit: number): Promise<Conversation[]>;
}

export interface MessageRepository {
  /** Returns null when `clientMessageId` was already stored (idempotent retries). */
  append(input: NewMessage, at: Date): Promise<Message | null>;
  findByClientId(conversationId: string, clientMessageId: string): Promise<Message | null>;
  listByConversation(
    conversationId: string,
    options: { after: Date | null; limit: number },
  ): Promise<Message[]>;
  lastMessage(conversationId: string): Promise<Message | null>;
  /** Marks messages written by the other party as read; returns how many changed. */
  markRead(conversationId: string, readerId: string, at: Date): Promise<number>;
  countUnread(conversationId: string, readerId: string): Promise<number>;
}

export interface NewReputationEvent {
  userId: string;
  kind: ReputationEventKind;
  delta: number;
  orderId: string | null;
  metadata: Record<string, unknown>;
}

export interface NewTradeRating {
  reservationId: string;
  raterId: string;
  subjectId: string;
  stars: number;
  comment: string | null;
}

export interface ReputationRepository {
  append(input: NewReputationEvent, at: Date): Promise<ReputationEvent>;
  listByUser(
    userId: string,
    options: { since: Date | null; limit: number },
  ): Promise<ReputationEvent[]>;
  /** Ratings received by a user, newest first. */
  listRatingsFor(userId: string, limit: number): Promise<TradeRating[]>;
  findRating(reservationId: string, raterId: string): Promise<TradeRating | null>;
  /** Null when the rater already rated this reservation (unique index). */
  createRating(input: NewTradeRating, at: Date): Promise<TradeRating | null>;
}

export interface NewNotification {
  userId: string;
  channel: 'IN_APP' | 'SMS' | 'PUSH';
  kind: NotificationKind;
  titleFa: string;
  bodyFa: string;
  payload: Record<string, unknown>;
  sentAt: Date | null;
}

export interface NotificationRepository {
  create(input: NewNotification, at: Date): Promise<NotificationRecord>;
  findById(id: string): Promise<NotificationRecord | null>;
  listByUser(
    userId: string,
    options: { limit: number; unreadOnly: boolean },
  ): Promise<NotificationRecord[]>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string, userId: string, at: Date): Promise<NotificationRecord | null>;
  markAllRead(userId: string, at: Date): Promise<number>;
}

/** Emitter port used by domain services to fan out domain events (task E5-03). */
export interface NotificationEmitter {
  emit(input: {
    userId: string;
    kind: NotificationKind;
    params: Record<string, string | number>;
    payload?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Trust events raised by the trade lifecycle (task E6-01). */
export interface ReputationRecorder {
  record(input: {
    userId: string;
    kind: ReputationEventKind;
    orderId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

export const NOOP_REPUTATION: ReputationRecorder = {
  record: async () => undefined,
};

/** Used by services in tests and tooling where fan-out is irrelevant. */
export const NOOP_NOTIFIER: NotificationEmitter = {
  emit: async () => undefined,
};

/**
 * Push channel for real-time clients (task E5-01). The HTTP layer owns the transport;
 * services only publish domain events, so an in-process hub or Redis fan-out both fit.
 */
export interface ChatEvent {
  type: 'message.created' | 'conversation.closed';
  conversationId: string;
  payload: Record<string, unknown>;
}

export interface ChatEventPublisher {
  publish(event: ChatEvent): void;
}

export const NOOP_CHAT_EVENTS: ChatEventPublisher = { publish: () => undefined };

export interface ZoneRepository {
  /** The active zone whose polygon contains the point, or null when out of coverage. */
  findByPoint(point: { lat: number; lng: number }): Promise<ZoneRecord | null>;
  findById(id: string): Promise<ZoneRecord | null>;
  findBySlug(slug: string): Promise<ZoneRecord | null>;
  listActive(): Promise<ZoneRecord[]>;
  upsert(zone: ZoneRecord): Promise<ZoneRecord>;
}

export interface SettingsRepository {
  findAll(): Promise<SettingsRecord[]>;
  set(key: string, value: unknown, updatedBy: string | null): Promise<SettingsRecord>;
}

export interface AuditRepository {
  append(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry>;
  list(limit: number): Promise<AuditEntry[]>;
}

/** Result of a drive between two points. */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Outbound routing port (OSRM/Mapbox/…). A failing or slow provider must never
 * break a response: DistanceService falls back to a straight-line estimate.
 */
export interface RouteProvider {
  route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteResult>;
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
  conversations: ConversationRepository;
  reputation: ReputationRepository;
  messages: MessageRepository;
  notifications: NotificationRepository;
  otps: OtpRepository;
  refreshTokens: RefreshTokenRepository;
  devices: DeviceRepository;
  orders: OrderRepository;
  reservations: ReservationRepository;
  settings: SettingsRepository;
  zones: ZoneRepository;
  audit: AuditRepository;
}

export type { UserStatus };
