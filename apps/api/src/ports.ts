import type {
  MessageKind,
  PaymentMethod,
  PaymentStatus,
  ReputationEventKind,
  NotificationKind,
  OrderSide,
  OrderStatus,
  ReservationStatus,
  SubscriptionStatus,
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
  Payment,
  PaymentCard,
  Plan,
  RefreshTokenRecord,
  Subscription,
  Reservation,
  SettingsRecord,
  User,
  ProviderSetting,
  ZoneRecord,
} from './domain/entities.js';

export interface NewUser {
  phone: string;
  role?: UserRole;
}

/** Paged admin listing (task E8-02); text matches phone or display name. */
export interface UserSearchQuery {
  text: string | null;
  role: UserRole | null;
  status: UserStatus | null;
  limit: number;
  offset: number;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Suspended accounts whose window elapsed — the scheduler restores them (E6-01). */
  listSuspendedDue(now: Date, limit: number): Promise<User[]>;
  findByPhone(phone: string): Promise<User | null>;
  create(input: NewUser): Promise<User>;
  save(user: User): Promise<User>;
  list(limit: number): Promise<User[]>;
  search(query: UserSearchQuery): Promise<{ items: User[]; total: number }>;
  /** Dashboard tile (task E8-08): counts grouped by status. */
  countByStatus(): Promise<Record<UserStatus, number>>;
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
  /** Admin listing across zones (task E8-03). */
  listAll(query: {
    status: OrderStatus | null;
    zoneId: string | null;
    side: OrderSide | null;
    text: string | null;
    limit: number;
    offset: number;
  }): Promise<{ items: Order[]; total: number }>;
  countByStatus(): Promise<Record<OrderStatus, number>>;
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
  countActive(): Promise<number>;
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

export interface PlanRepository {
  listActive(): Promise<Plan[]>;
  findById(id: string): Promise<Plan | null>;
  findByCode(code: string): Promise<Plan | null>;
  upsert(plan: Plan): Promise<Plan>;
}

export interface NewSubscription {
  userId: string;
  planId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface SubscriptionRepository {
  create(input: NewSubscription): Promise<Subscription>;
  findById(id: string): Promise<Subscription | null>;
  /** The subscription that covers `now` for this user, latest window wins. */
  findActiveByUser(userId: string, now: Date): Promise<Subscription | null>;
  activate(id: string, startsAt: Date, endsAt: Date): Promise<Subscription | null>;
  listDueExpiry(now: Date, limit: number): Promise<Subscription[]>;
  expire(id: string): Promise<Subscription | null>;
  listByUser(userId: string, limit: number): Promise<Subscription[]>;
  listAll(query: {
    status: SubscriptionStatus | null;
    limit: number;
    offset: number;
  }): Promise<{ items: Subscription[]; total: number }>;
  countByStatus(): Promise<Record<SubscriptionStatus, number>>;
}

export interface NewPayment {
  userId: string;
  subscriptionId: string | null;
  provider: PaymentMethod;
  amountToman: number;
  uniqueAmountToman: number | null;
  expiresAt: Date;
}

export interface PaymentRepository {
  /** Returns null when `uniqueAmountToman` collides with another PENDING payment. */
  create(input: NewPayment, at: Date): Promise<Payment | null>;
  findById(id: string): Promise<Payment | null>;
  findByAuthority(authority: string): Promise<Payment | null>;
  findByUniqueAmount(amountToman: number): Promise<Payment | null>;
  transition(
    id: string,
    expected: PaymentStatus,
    next: PaymentStatus,
    patch?: Partial<Pick<Payment, 'paidAt' | 'reference' | 'authority'>>,
  ): Promise<Payment | null>;
  listPendingExpired(now: Date, limit: number): Promise<Payment[]>;
  listByUser(userId: string, limit: number): Promise<Payment[]>;
  listAll(options: { status: PaymentStatus | null; limit: number }): Promise<Payment[]>;
  /** Revenue tiles: settled volume since `since` plus how many are waiting or failed. */
  summary(since: Date): Promise<{
    paidCount: number;
    paidToman: number;
    pendingCount: number;
    failedCount: number;
    expiredCount: number;
  }>;
}

export interface PaymentCardRepository {
  list(activeOnly: boolean): Promise<PaymentCard[]>;
  findById(id: string): Promise<PaymentCard | null>;
  create(input: Omit<PaymentCard, 'id' | 'createdAt' | 'isActive'>, at: Date): Promise<PaymentCard>;
  deactivate(id: string): Promise<PaymentCard | null>;
}

/** Result of starting a payment with a provider. */
export interface PaymentInitResult {
  /** Where to send the user (gateway only). */
  redirectUrl: string | null;
  /** Provider-side handle (gateway authority). */
  authority: string | null;
  destination: { cardNumber: string; holderName: string; bankName: string | null } | null;
  uniqueAmountToman: number | null;
}

export interface PaymentProvider {
  readonly kind: PaymentMethod;
  init(input: {
    paymentId: string;
    amountToman: number;
    uniqueAmountToman: number | null;
    descriptionFa: string;
  }): Promise<PaymentInitResult>;
  verify(input: {
    paymentId: string;
    amountToman: number;
    authority: string | null;
    reference: string | null;
  }): Promise<{ ok: boolean; reference: string | null; reason: string | null }>;
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
  /** Every zone, active or not — the city management screen (task E8-07). */
  listAll(): Promise<ZoneRecord[]>;
  upsert(zone: ZoneRecord): Promise<ZoneRecord>;
}

/** Provider credentials edited from the panel (task E8-06). */
export interface ProviderSettingsRepository {
  list(): Promise<ProviderSetting[]>;
  findBy(kind: ProviderSetting['kind'], provider: string): Promise<ProviderSetting | null>;
  upsert(
    input: Omit<ProviderSetting, 'id' | 'updatedAt'> & { id?: string },
    at: Date,
  ): Promise<ProviderSetting>;
}

export interface SettingsRepository {
  findAll(): Promise<SettingsRecord[]>;
  set(key: string, value: unknown, updatedBy: string | null): Promise<SettingsRecord>;
}

export interface AuditQuery {
  action: string | null;
  actorId: string | null;
  entity: string | null;
  limit: number;
  offset: number;
}

export interface AuditRepository {
  append(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry>;
  list(limit: number): Promise<AuditEntry[]>;
  /** Filtered audit browser (task E8-09). */
  query(input: AuditQuery): Promise<{ items: AuditEntry[]; total: number }>;
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

/**
 * Outbound SMS port.
 *
 * `send` carries free text (notifications, the admin test message). `sendCode` carries a one-time
 * code on its own: providers with an approved template deliver it through their verify endpoint
 * (cheaper, and it reaches numbers that block promotional SMS), the rest fall back to `send` with
 * the configured OTP text. Keeping both on the port means a new provider cannot silently push
 * codes into the free-text channel, and the auth flow never has to know which kind it got.
 */
export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
  sendCode(phone: string, code: string): Promise<void>;
}

export interface IdGenerator {
  (): string;
}

export interface Repositories {
  users: UserRepository;
  conversations: ConversationRepository;
  reputation: ReputationRepository;
  plans: PlanRepository;
  subscriptions: SubscriptionRepository;
  payments: PaymentRepository;
  paymentCards: PaymentCardRepository;
  providerSettings: ProviderSettingsRepository;
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
