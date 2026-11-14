import {
  AppError,
  USER_ROLE_FA,
  nextOrderStatus,
  nextReservationStatus,
  type NotificationKind,
  type OrderStatus,
  type Settings,
  type UserRole,
  type UserStatus,
} from '@benzin/shared';
import type { AuditEntry, Clock, Order, ProviderSetting, User } from '../domain/entities.js';
import type { NotificationEmitter, Repositories, SmsSender } from '../ports.js';
import type { ReputationService } from './reputation-service.js';
import type { SettingsService } from './settings-service.js';

/**
 * Admin back-office service (epic E8). Every mutation writes an audit row and, when a
 * person is affected, a Persian notification — the panel never changes state silently.
 */

export interface AdminUserRow {
  id: string;
  phone: string;
  displayName: string | null;
  role: UserRole;
  roleFa: string;
  status: UserStatus;
  suspendedUntil: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserRow {
  reputation: { score: number; level: string; levelFa: string };
  counts: { orders: number; reservations: number; payments: number; subscriptions: number };
  subscription: { planCode: string | null; status: string; endsAt: string } | null;
}

export interface AdminOrderRow {
  id: string;
  ownerId: string;
  ownerPhone: string | null;
  side: Order['side'];
  tier: Order['tier'];
  litres: number;
  rateToman: number;
  totalToman: number;
  status: OrderStatus;
  zoneId: string;
  stationName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AdminOrderDetail extends AdminOrderRow {
  note: string | null;
  reservations: {
    id: string;
    takerId: string;
    takerPhone: string | null;
    status: string;
    createdAt: string;
    decidedAt: string | null;
    completedAt: string | null;
    cancelReason: string | null;
  }[];
}

export interface AdminDashboard {
  users: { total: number; active: number; suspended: number; banned: number };
  orders: { byStatus: Record<string, number>; open: number; completed: number };
  reservations: { active: number };
  subscriptions: { active: number; pending: number };
  payments: {
    paidCount: number;
    paidToman: number;
    pendingCount: number;
    failedCount: number;
    expiredCount: number;
  };
  /** Tiles come formatted from the server so the client never re-implements Persian digits. */
  tiles: { labelFa: string; value: string; hintFa: string }[];
  recentAudit: AdminAuditRow[];
  generatedAt: string;
}

export interface AdminAuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminSystemStatus {
  mode: 'memory' | 'postgres';
  nodeEnv: string;
  version: string;
  uptimeSeconds: number;
  serverTime: string;
  checks: { name: string; ok: boolean; detailFa: string }[];
  providers: { kind: string; provider: string; isActive: boolean }[];
  settingsKeys: number;
}

export interface AdminProviderView {
  id: string;
  provider: string;
  kind: ProviderSetting['kind'];
  isActive: boolean;
  /** Secrets are replaced by `••••` — the panel never receives a key back. */
  config: Record<string, unknown>;
}

const SECRET_KEY = /(secret|key|token|password)/i;

export const maskSecrets = (config: Record<string, unknown>): Record<string, unknown> => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEY.test(key) && typeof value === 'string' && value.length > 0) {
      masked[key] = '••••';
      continue;
    }
    masked[key] = value;
  }
  return masked;
};

const toUserRow = (user: User): AdminUserRow => ({
  id: user.id,
  phone: user.phone,
  displayName: user.displayName,
  role: user.role,
  roleFa: USER_ROLE_FA[user.role],
  status: user.status,
  suspendedUntil: user.suspendedUntil?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

const toAuditRow = (entry: AuditEntry): AdminAuditRow => ({
  id: entry.id,
  actorId: entry.actorId,
  action: entry.action,
  entity: entry.entity,
  entityId: entry.entityId,
  metadata: entry.metadata,
  createdAt: entry.createdAt.toISOString(),
});

const toProviderView = (setting: ProviderSetting): AdminProviderView => ({
  id: setting.id,
  provider: setting.provider,
  kind: setting.kind,
  isActive: setting.isActive,
  config: maskSecrets(setting.config),
});

export class AdminService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly repos: Pick<
      Repositories,
      | 'users'
      | 'orders'
      | 'reservations'
      | 'payments'
      | 'subscriptions'
      | 'plans'
      | 'zones'
      | 'audit'
      | 'settings'
      | 'providerSettings'
    >,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly notifier: NotificationEmitter,
    private readonly reputation: ReputationService,
    private readonly sms: SmsSender,
    private readonly env: { nodeEnv: string; mode: 'memory' | 'postgres'; version: string },
  ) {}

  private async notify(
    userId: string,
    kind: NotificationKind,
    params: Record<string, string | number>,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.notifier.emit({ userId, kind, params, payload });
  }

  private async audit(
    actor: User,
    action: string,
    entity: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.repos.audit.append({ actorId: actor.id, action, entity, entityId, metadata });
  }

  // ------------------------------------------------------------------ users

  async listUsers(query: {
    q?: string | undefined;
    role?: UserRole | undefined;
    status?: UserStatus | undefined;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminUserRow[]; total: number; limit: number; offset: number }> {
    const result = await this.repos.users.search({
      text: query.q ?? null,
      role: query.role ?? null,
      status: query.status ?? null,
      limit: query.limit,
      offset: query.offset,
    });
    return {
      items: result.items.map(toUserRow),
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async userDetail(id: string): Promise<AdminUserDetail> {
    const user = await this.repos.users.findById(id);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    const now = this.clock.now();
    const [score, orders, payments, subscriptions, activeReservations] = await Promise.all([
      this.reputation.publicProfile(id),
      this.repos.orders.listByOwner(id, 200),
      this.repos.payments.listByUser(id, 200),
      this.repos.subscriptions.listByUser(id, 50),
      this.repos.reservations.countActiveByTaker(id),
    ]);
    const active = subscriptions.find(
      (subscription) =>
        subscription.status === 'ACTIVE' && subscription.endsAt.getTime() > now.getTime(),
    );
    const plan = active ? await this.repos.plans.findById(active.planId) : null;
    return {
      ...toUserRow(user),
      reputation: { score: score.score, level: score.level, levelFa: score.levelFa },
      counts: {
        orders: orders.length,
        reservations: activeReservations,
        payments: payments.length,
        subscriptions: subscriptions.length,
      },
      subscription: active
        ? {
            planCode: plan?.code ?? null,
            status: active.status,
            endsAt: active.endsAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * Role, profile and availability edits (E8-02). A manual suspension uses the same
   * `suspendedUntil` field the trust engine uses, so one scheduler sweep restores both.
   */
  async updateUser(
    actor: User,
    id: string,
    input: {
      role?: UserRole | undefined;
      displayName?: string | null | undefined;
      status?: UserStatus | undefined;
      suspendHours?: number | undefined;
      reason?: string | undefined;
    },
  ): Promise<AdminUserRow> {
    const user = await this.repos.users.findById(id);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    if (user.role === 'OWNER' && actor.role !== 'OWNER') {
      throw AppError.forbidden('FORBIDDEN', 'Only the owner can change another owner');
    }
    const now = this.clock.now();
    const roleChanged = input.role !== undefined && input.role !== user.role;

    if (input.displayName !== undefined) user.displayName = input.displayName;
    if (input.role !== undefined) user.role = input.role;
    if (input.status === 'SUSPENDED') {
      user.status = 'SUSPENDED';
      user.suspendedUntil = new Date(now.getTime() + (input.suspendHours ?? 24) * 3_600_000);
    } else if (input.status === 'BANNED') {
      user.status = 'BANNED';
      user.suspendedUntil = null;
    } else if (input.status === 'ACTIVE') {
      user.status = 'ACTIVE';
      user.suspendedUntil = null;
    }
    const saved = await this.repos.users.save(user);

    await this.audit(actor, 'user.updated', 'user', id, {
      role: input.role ?? null,
      status: input.status ?? null,
      suspendHours: input.suspendHours ?? null,
      reason: input.reason ?? null,
    });

    if (input.status === 'SUSPENDED') {
      const score = (await this.reputation.publicProfile(saved.id)).score;
      await this.notify(saved.id, 'ACCOUNT_SUSPENDED', {
        score,
        hours: input.suspendHours ?? 24,
      });
    } else if (input.status === 'ACTIVE') {
      const score = (await this.reputation.publicProfile(saved.id)).score;
      await this.notify(saved.id, 'ACCOUNT_RESTORED', { score });
    }
    if (roleChanged && input.role) {
      await this.notify(saved.id, 'ACCOUNT_ROLE_CHANGED', { role: USER_ROLE_FA[input.role] });
    }
    return toUserRow(saved);
  }

  /** E8-10: the first owner account is created by one CLI command, never from a public route. */
  async createOwner(phone: string, displayName: string): Promise<AdminUserRow> {
    const existing = await this.repos.users.findByPhone(phone);
    if (existing) {
      if (existing.role === 'OWNER') return toUserRow(existing);
      throw new AppError('OWNER_ALREADY_EXISTS', 409, 'This phone already has another role', {
        role: existing.role,
      });
    }
    const created = await this.repos.users.create({ phone, role: 'OWNER' });
    created.displayName = displayName;
    const saved = await this.repos.users.save(created);
    await this.repos.audit.append({
      actorId: null,
      action: 'user.owner_created',
      entity: 'user',
      entityId: saved.id,
      metadata: { phone },
    });
    return toUserRow(saved);
  }

  // ----------------------------------------------------------------- orders

  async listOrders(query: {
    status?: OrderStatus | undefined;
    zoneId?: string | undefined;
    side?: Order['side'] | undefined;
    q?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminOrderRow[]; total: number; limit: number; offset: number }> {
    const result = await this.repos.orders.listAll({
      status: query.status ?? null,
      zoneId: query.zoneId ?? null,
      side: query.side ?? null,
      text: query.q ?? null,
      limit: query.limit,
      offset: query.offset,
    });
    const items: AdminOrderRow[] = [];
    for (const order of result.items) {
      const owner = await this.repos.users.findById(order.ownerId);
      items.push({
        id: order.id,
        ownerId: order.ownerId,
        ownerPhone: owner?.phone ?? null,
        side: order.side,
        tier: order.tier,
        litres: order.litres,
        rateToman: order.rateToman,
        totalToman: Math.round(order.litres * order.rateToman),
        status: order.status,
        zoneId: order.zoneId,
        stationName: order.stationName,
        createdAt: order.createdAt.toISOString(),
        expiresAt: order.expiresAt.toISOString(),
      });
    }
    return { items, total: result.total, limit: query.limit, offset: query.offset };
  }

  async orderDetail(id: string): Promise<AdminOrderDetail> {
    const order = await this.repos.orders.findById(id);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    const owner = await this.repos.users.findById(order.ownerId);
    const reservations = await this.repos.reservations.listByOrder(id, 20);
    const rows: AdminOrderDetail['reservations'] = [];
    for (const reservation of reservations) {
      const taker = await this.repos.users.findById(reservation.takerId);
      rows.push({
        id: reservation.id,
        takerId: reservation.takerId,
        takerPhone: taker?.phone ?? null,
        status: reservation.status,
        createdAt: reservation.createdAt.toISOString(),
        decidedAt: reservation.decidedAt?.toISOString() ?? null,
        completedAt: reservation.completedAt?.toISOString() ?? null,
        cancelReason: reservation.cancelReason,
      });
    }
    return {
      id: order.id,
      ownerId: order.ownerId,
      ownerPhone: owner?.phone ?? null,
      side: order.side,
      tier: order.tier,
      litres: order.litres,
      rateToman: order.rateToman,
      totalToman: Math.round(order.litres * order.rateToman),
      status: order.status,
      zoneId: order.zoneId,
      stationName: order.stationName,
      note: order.note,
      createdAt: order.createdAt.toISOString(),
      expiresAt: order.expiresAt.toISOString(),
      reservations: rows,
    };
  }

  /**
   * E8-03: only staff close a dispute, and only through the shared state machine
   * (`RESOLVE_COMPLETE → COMPLETED`, `RESOLVE_CANCEL → CANCELLED_BY_OWNER`).
   */
  async resolveDispute(
    actor: User,
    orderId: string,
    input: { outcome: 'COMPLETE' | 'CANCEL'; note: string },
  ): Promise<AdminOrderDetail> {
    const order = await this.repos.orders.findById(orderId);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    if (order.status !== 'DISPUTED') {
      throw new AppError('DISPUTE_NOT_OPEN', 409, 'This order is not disputed', {
        status: order.status,
      });
    }
    // A disputed reservation is no longer "active", so look it up among all of them.
    const reservations = await this.repos.reservations.listByOrder(orderId, 10);
    const reservation =
      reservations.find((row) => row.status === 'DISPUTED') ??
      reservations.find((row) => row.status === 'CONFIRMED');
    if (!reservation) throw AppError.conflict('CONFLICT', 'Disputed order lost its reservation');

    const event = input.outcome === 'COMPLETE' ? 'RESOLVE_COMPLETE' : 'RESOLVE_CANCEL';
    const now = this.clock.now();
    const nextReservation = nextReservationStatus(reservation.status, event, 'ADMIN');
    const nextOrder = nextOrderStatus(order.status, event, 'ADMIN');

    const updatedReservation = await this.repos.reservations.transition(
      reservation.id,
      reservation.status,
      nextReservation,
      {
        completedAt: input.outcome === 'COMPLETE' ? now : null,
        cancelReason: input.note,
      },
    );
    if (!updatedReservation) {
      throw AppError.conflict('CONFLICT', 'Reservation changed while resolving');
    }
    const updatedOrder = await this.repos.orders.transition(orderId, order.status, nextOrder);
    if (!updatedOrder) throw AppError.conflict('CONFLICT', 'Order changed while resolving');

    await this.audit(actor, 'order.dispute_resolved', 'order', orderId, {
      outcome: input.outcome,
      note: input.note,
      reservationId: reservation.id,
      previousStatus: order.status,
      nextStatus: nextOrder,
    });

    const outcomeFa =
      input.outcome === 'COMPLETE' ? 'معامله به نفع هر دو طرف تأیید شد' : 'معامله لغو شد';
    for (const userId of [order.ownerId, reservation.takerId]) {
      await this.notify(
        userId,
        'DISPUTE_RESOLVED',
        { litres: order.litres, outcome: outcomeFa },
        { orderId, reservationId: reservation.id, note: input.note },
      );
    }
    if (input.outcome === 'COMPLETE') {
      for (const userId of [order.ownerId, reservation.takerId]) {
        await this.reputation.record({
          userId,
          kind: 'TRADE_COMPLETED',
          orderId,
          metadata: { resolvedBy: actor.id },
        });
      }
    }
    return this.orderDetail(orderId);
  }

  // ---------------------------------------------------------- subscriptions

  async listSubscriptions(query: {
    status?: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | undefined;
    limit: number;
    offset: number;
  }): Promise<{
    items: {
      id: string;
      userId: string;
      phone: string | null;
      planCode: string | null;
      planNameFa: string | null;
      status: string;
      startsAt: string;
      endsAt: string;
      createdAt: string;
    }[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const result = await this.repos.subscriptions.listAll({
      status: query.status ?? null,
      limit: query.limit,
      offset: query.offset,
    });
    const items = [];
    for (const subscription of result.items) {
      const [user, plan] = await Promise.all([
        this.repos.users.findById(subscription.userId),
        this.repos.plans.findById(subscription.planId),
      ]);
      items.push({
        id: subscription.id,
        userId: subscription.userId,
        phone: user?.phone ?? null,
        planCode: plan?.code ?? null,
        planNameFa: plan?.nameFa ?? null,
        status: subscription.status,
        startsAt: subscription.startsAt.toISOString(),
        endsAt: subscription.endsAt.toISOString(),
        createdAt: subscription.createdAt.toISOString(),
      });
    }
    return { items, total: result.total, limit: query.limit, offset: query.offset };
  }

  // ------------------------------------------------------------- dashboard

  async dashboard(): Promise<AdminDashboard> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const [userCounts, orderCounts, reservationCount, payments, subscriptionCounts, audit] =
      await Promise.all([
        this.repos.users.countByStatus(),
        this.repos.orders.countByStatus(),
        this.repos.reservations.countActive(),
        this.repos.payments.summary(since),
        this.repos.subscriptions.countByStatus(),
        this.repos.audit.list(8),
      ]);
    const totalUsers = userCounts.ACTIVE + userCounts.SUSPENDED + userCounts.BANNED;
    const openOrders = orderCounts.OPEN + orderCounts.RESERVED;

    const tiles = [
      {
        labelFa: 'کاربران فعال',
        value: userCounts.ACTIVE.toLocaleString('fa-IR'),
        hintFa: `${userCounts.SUSPENDED} تعلیق‌شده · ${userCounts.BANNED} مسدود`,
      },
      {
        labelFa: 'سفارش‌های باز',
        value: openOrders.toLocaleString('fa-IR'),
        hintFa: `${reservationCount} رزرو زنده`,
      },
      {
        labelFa: 'درآمد ۲۴ ساعت',
        value: `${payments.paidToman.toLocaleString('fa-IR')} تومان`,
        hintFa: `${payments.paidCount} پرداخت تأییدشده`,
      },
      {
        labelFa: 'در انتظار بررسی',
        value: payments.pendingCount.toLocaleString('fa-IR'),
        hintFa: 'کارت‌به‌کارت و درگاه',
      },
      {
        labelFa: 'معاملات تکمیل‌شده',
        value: orderCounts.COMPLETED.toLocaleString('fa-IR'),
        hintFa: `${orderCounts.DISPUTED} اختلاف باز`,
      },
      {
        labelFa: 'اشتراک فعال',
        value: subscriptionCounts.ACTIVE.toLocaleString('fa-IR'),
        hintFa: `${subscriptionCounts.PENDING} در انتظار پرداخت`,
      },
    ];

    return {
      users: {
        total: totalUsers,
        active: userCounts.ACTIVE,
        suspended: userCounts.SUSPENDED,
        banned: userCounts.BANNED,
      },
      orders: { byStatus: { ...orderCounts }, open: openOrders, completed: orderCounts.COMPLETED },
      reservations: { active: reservationCount },
      subscriptions: {
        active: subscriptionCounts.ACTIVE,
        pending: subscriptionCounts.PENDING,
      },
      payments,
      tiles,
      recentAudit: audit.map(toAuditRow),
      generatedAt: now.toISOString(),
    };
  }

  async systemStatus(): Promise<AdminSystemStatus> {
    const config: Settings = await this.settings.get();
    const providers = await this.repos.providerSettings.list();
    const zones = await this.repos.zones.listAll();
    const activeProviders = providers.filter((provider) => provider.isActive).length;
    return {
      mode: this.env.mode,
      nodeEnv: this.env.nodeEnv,
      version: this.env.version,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      serverTime: this.clock.now().toISOString(),
      checks: [
        {
          name: 'repositories',
          ok: true,
          detailFa: this.env.mode === 'postgres' ? 'PostgreSQL متصل' : 'حافظه‌ی موقت (فقط توسعه)',
        },
        {
          name: 'zones',
          ok: zones.length > 0,
          detailFa: zones.length > 0 ? `${zones.length} شهر تعریف شده` : 'هیچ شهری فعال نیست',
        },
        {
          name: 'sms',
          ok: config['notification.sms_enabled'],
          detailFa: config['notification.sms_enabled'] ? 'پیامک فعال است' : 'پیامک خاموش است',
        },
        {
          name: 'providers',
          ok: activeProviders > 0,
          detailFa: `${activeProviders} ارائه‌دهنده فعال`,
        },
      ],
      providers: providers.map((provider) => ({
        kind: provider.kind,
        provider: provider.provider,
        isActive: provider.isActive,
      })),
      settingsKeys: Object.keys(config).length,
    };
  }

  // -------------------------------------------------------------- providers

  async listProviders(): Promise<{ items: AdminProviderView[] }> {
    const items = await this.repos.providerSettings.list();
    return { items: items.map(toProviderView) };
  }

  async saveProvider(
    actor: User,
    input: {
      provider: string;
      kind: ProviderSetting['kind'];
      isActive: boolean;
      config: Record<string, unknown>;
    },
  ): Promise<AdminProviderView> {
    const existing = await this.repos.providerSettings.findBy(input.kind, input.provider);
    // A masked placeholder means "keep the stored secret", so the panel never round-trips it.
    const config: Record<string, unknown> = { ...input.config };
    for (const [key, value] of Object.entries(config)) {
      if (value === '••••' && existing) config[key] = existing.config[key];
    }
    const saved = await this.repos.providerSettings.upsert(
      {
        provider: input.provider,
        kind: input.kind,
        config,
        isActive: input.isActive,
        updatedBy: actor.id,
      },
      this.clock.now(),
    );
    await this.audit(actor, 'provider.updated', 'provider', saved.id, {
      provider: saved.provider,
      kind: saved.kind,
      isActive: saved.isActive,
    });
    return toProviderView(saved);
  }

  /** E8-06: proves the stored credentials work without leaving the panel. */
  async testProvider(
    actor: User,
    kind: ProviderSetting['kind'],
    provider: string,
    phone: string,
  ): Promise<{ ok: boolean; provider: string; deliveredTo: string }> {
    const setting = await this.repos.providerSettings.findBy(kind, provider);
    if (!setting) throw AppError.notFound('PROVIDER_NOT_FOUND', 'Provider is not configured');
    if (!setting.isActive) {
      throw new AppError('PROVIDER_TEST_FAILED', 409, 'Provider is disabled');
    }
    if (kind !== 'SMS') {
      throw new AppError('PROVIDER_TEST_FAILED', 422, 'Only SMS providers can be tested here');
    }
    try {
      await this.sms.send(phone, 'پیام آزمایشی بنزین: تنظیمات پنل پیامک درست است.');
    } catch {
      throw new AppError('PROVIDER_TEST_FAILED', 502, 'Provider rejected the test message');
    }
    await this.audit(actor, 'provider.tested', 'provider', setting.id, { phone });
    return { ok: true, provider: setting.provider, deliveredTo: phone };
  }

  // ----------------------------------------------------------------- zones

  async listZones(): Promise<{
    items: {
      id: string;
      slug: string;
      nameFa: string;
      city: string;
      province: string;
      isActive: boolean;
      vertices: number;
    }[];
  }> {
    const zones = await this.repos.zones.listAll();
    return {
      items: zones.map((zone) => ({
        id: zone.id,
        slug: zone.slug,
        nameFa: zone.nameFa,
        city: zone.city,
        province: zone.province,
        isActive: zone.isActive,
        vertices: zone.boundary.length,
      })),
    };
  }

  /** E8-07: activating a city is the switch that opens the market there. */
  async saveZone(
    actor: User,
    input: {
      slug: string;
      nameFa: string;
      city: string;
      province: string;
      isActive: boolean;
      boundary: [number, number][];
    },
  ): Promise<{ id: string; slug: string; isActive: boolean }> {
    const existing = await this.repos.zones.findBySlug(input.slug);
    const id = existing?.id ?? crypto.randomUUID();
    const zone = await this.repos.zones.upsert({
      id,
      slug: input.slug,
      nameFa: input.nameFa,
      city: input.city,
      province: input.province,
      isActive: input.isActive,
      boundary: input.boundary,
    });
    await this.audit(actor, existing ? 'zone.updated' : 'zone.created', 'zone', zone.id, {
      slug: zone.slug,
      isActive: zone.isActive,
      vertices: zone.boundary.length,
    });
    return { id: zone.id, slug: zone.slug, isActive: zone.isActive };
  }

  // ----------------------------------------------------------------- audit

  async auditLog(query: {
    action?: string | undefined;
    actorId?: string | undefined;
    entity?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminAuditRow[]; total: number; limit: number; offset: number }> {
    const result = await this.repos.audit.query({
      action: query.action ?? null,
      actorId: query.actorId ?? null,
      entity: query.entity ?? null,
      limit: query.limit,
      offset: query.offset,
    });
    return {
      items: result.items.map(toAuditRow),
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
