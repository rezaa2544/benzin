import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the single source of truth for the database shape (task E2-01).
 * `drizzle-kit generate` emits the SQL into `infra/migrations`; the generated files are
 * committed so deployments are reviewed like code.
 *
 * Two rules encoded here that the domain depends on:
 *  1. `reservations_one_active_per_order` — partial unique index: one live reservation per order.
 *  2. GiST indexes on `orders.location` and `zones.boundary` for proximity / "inside the city".
 */

/** PostGIS geography, declared as a custom type so Drizzle keeps the real column type. */
const geography = customType<{
  data: string;
  driverData: string;
  config: { type?: 'POINT' | 'POLYGON' };
}>({
  dataType(config) {
    return `geography(${config?.type ?? 'POINT'}, 4326)`;
  },
});

export const userRole = pgEnum('user_role', ['USER', 'SUPPORT', 'ADMIN', 'OWNER']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'BANNED']);
export const tierType = pgEnum('tier_type', ['T1500', 'T3000', 'T10000']);
export const orderSide = pgEnum('order_side', ['SELL', 'BUY']);
export const orderStatus = pgEnum('order_status', [
  'OPEN',
  'RESERVED',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'AWAITING_OWNER_DECISION',
  'DISPUTED',
]);
export const reservationStatus = pgEnum('reservation_status', [
  'PENDING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'AUTO_COMPLETED',
  'DISPUTED',
  'EXPIRED',
  'CANCELLED_BY_TAKER',
  'CANCELLED_BY_OWNER',
  'REJECTED',
]);
export const deliveryMethod = pgEnum('delivery_method', ['FUEL_CARD']);
export const paymentProvider = pgEnum('payment_provider', ['CARD_TO_CARD', 'GATEWAY']);
export const paymentStatus = pgEnum('payment_status', [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'NEEDS_REVIEW',
]);
export const subscriptionStatus = pgEnum('subscription_status', [
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'PENDING',
]);
export const notificationChannel = pgEnum('notification_channel', ['PUSH', 'SMS', 'IN_APP']);
export const reportStatus = pgEnum('report_status', ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull().unique(),
    displayName: text('display_name'),
    role: userRole('role').notNull().default('USER'),
    status: userStatus('status').notNull().default('ACTIVE'),
    walletBalance: bigint('wallet_balance', { mode: 'number' }).notNull().default(0),
    reputation: integer('reputation').notNull().default(0),
    /** Trust suspension window (task E6-01); null when the account is unrestricted. */
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('users_phone_format', sql`${t.phone} ~ '^09[0-9]{9}$'`),
    check('users_wallet_non_negative', sql`${t.walletBalance} >= 0`),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    deviceId: text('device_id').notNull(),
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('devices_user_device_idx').on(t.userId, t.deviceId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /** Rotation chain: every token descended from one login shares a family. */
    familyId: uuid('family_id').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Set when this token was rotated; a revoked token without it was logged out. */
    replacedBy: uuid('replaced_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_active_idx')
      .on(t.userId)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_challenges_phone_idx').on(t.phone, t.sentAt)],
);

export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nameFa: text('name_fa').notNull(),
    slug: text('slug').notNull().unique(),
    boundary: geography('boundary', { type: 'POLYGON' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    city: text('city').notNull(),
    province: text('province').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('zones_boundary_gist').using('gist', t.boundary)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    side: orderSide('side').notNull(),
    tier: tierType('tier').notNull(),
    litres: numeric('litres', { precision: 10, scale: 2 }).notNull(),
    rateToman: integer('rate_toman').notNull(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id, { onDelete: 'restrict' }),
    stationName: text('station_name'),
    note: text('note'),
    location: geography('location'),
    deliveryMethod: deliveryMethod('delivery_method').notNull().default('FUEL_CARD'),
    status: orderStatus('status').notNull().default('OPEN'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('orders_litres_positive', sql`${t.litres} > 0`),
    check('orders_rate_positive', sql`${t.rateToman} > 0`),
    index('orders_open_search_idx')
      .on(t.zoneId, t.side, t.tier, t.rateToman, t.createdAt)
      .where(sql`status = 'OPEN'`),
    index('orders_owner_idx').on(t.ownerId, t.createdAt),
    index('orders_location_gist').using('gist', t.location),
    index('orders_expiry_idx')
      .on(t.expiresAt)
      .where(sql`status = 'OPEN'`),
  ],
);

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    takerId: uuid('taker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: reservationStatus('status').notNull().default('PENDING_OWNER'),
    message: text('message'),
    cancelReason: text('cancel_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The database half of the concurrency guarantee tested in apps/api/test/reservations.test.ts.
    uniqueIndex('reservations_one_active_per_order')
      .on(t.orderId)
      .where(sql`status IN ('PENDING_OWNER', 'CONFIRMED')`),
    index('reservations_taker_active_idx')
      .on(t.takerId)
      .where(sql`status IN ('PENDING_OWNER', 'CONFIRMED')`),
    index('reservations_pending_expiry_idx')
      .on(t.expiresAt)
      .where(sql`status = 'PENDING_OWNER'`),
    index('reservations_order_idx').on(t.orderId, t.createdAt),
  ],
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    tier: tierType('tier').notNull(),
    litres: numeric('litres', { precision: 10, scale: 2 }).notNull(),
    rateToman: integer('rate_toman').notNull(),
    totalToman: integer('total_toman').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('trades_parties_differ', sql`${t.sellerId} <> ${t.buyerId}`),
    index('trades_seller_idx').on(t.sellerId, t.createdAt),
    index('trades_buyer_idx').on(t.buyerId, t.createdAt),
  ],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    /** TEXT (free text), CONTACT (deliberate phone card) or SYSTEM (platform line). */
    kind: text('kind').notNull().default('TEXT'),
    body: text('body').notNull(),
    clientMessageId: uuid('client_message_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('messages_body_length', sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
    check('messages_kind_check', sql`${t.kind} IN ('TEXT', 'CONTACT', 'SYSTEM')`),
    uniqueIndex('messages_conversation_client_idx').on(t.conversationId, t.clientMessageId),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  ],
);

export const tradeRatings = pgTable(
  'trade_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('trade_ratings_stars_check', sql`${t.stars} BETWEEN 1 AND 5`),
    uniqueIndex('trade_ratings_one_per_rater_idx').on(t.reservationId, t.raterId),
    index('trade_ratings_subject_idx').on(t.subjectId, t.createdAt),
  ],
);

export const reputationEvents = pgTable(
  'reputation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reputation_events_user_idx').on(t.userId, t.createdAt)],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  details: text('details'),
  status: reportStatus('status').notNull().default('OPEN'),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nameFa: text('name_fa').notNull(),
  durationDays: integer('duration_days').notNull(),
  priceToman: integer('price_toman').notNull(),
  maxActiveOrders: smallint('max_active_orders').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus('status').notNull().default('PENDING'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('subscriptions_window', sql`${t.endsAt} > ${t.startsAt}`),
    index('subscriptions_user_active_idx')
      .on(t.userId, t.endsAt)
      .where(sql`status = 'ACTIVE'`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    provider: paymentProvider('provider').notNull(),
    status: paymentStatus('status').notNull().default('PENDING'),
    amountToman: integer('amount_toman').notNull(),
    authority: text('authority'),
    reference: text('reference'),
    uniqueAmount: integer('unique_amount'),
    rawPayload: jsonb('raw_payload').notNull().default({}),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('payments_amount_positive', sql`${t.amountToman} > 0`),
    uniqueIndex('payments_unique_amount_idx')
      .on(t.uniqueAmount)
      .where(sql`status = 'PENDING'`),
    index('payments_user_idx').on(t.userId, t.createdAt),
  ],
);

export const paymentCards = pgTable('payment_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardNumber: text('card_number').notNull(),
  holderName: text('holder_name').notNull(),
  bankName: text('bank_name'),
  isActive: boolean('is_active').notNull().default(true),
  dailyLimit: integer('daily_limit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const providerSettings = pgTable(
  'provider_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    config: jsonb('config').notNull().default({}),
    isActive: boolean('is_active').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('provider_settings_kind_provider_idx').on(t.kind, t.provider)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull().default('IN_APP'),
    /** Template key from packages/shared/src/notifications.ts. */
    kind: text('kind').notNull().default('SYSTEM'),
    titleFa: text('title_fa').notNull(),
    bodyFa: text('body_fa').notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`read_at IS NULL`),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entity, t.entityId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
  ],
);
