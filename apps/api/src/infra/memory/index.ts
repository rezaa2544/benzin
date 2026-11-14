import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  DeviceRecord,
  Order,
  RefreshTokenRecord,
  ProviderSetting,
  Reservation,
  SettingsRecord,
  User,
} from '../../domain/entities.js';
import type {
  AuditQuery,
  AuditRepository,
  NewOrder,
  NewReservation,
  NewUser,
  OrderRepository,
  OrderSearchQuery,
  OtpChallenge,
  DeviceInput,
  DeviceRepository,
  NewRefreshToken,
  OtpRepository,
  ProviderSettingsRepository,
  RefreshTokenRepository,
  Repositories,
  ReservationRepository,
  SettingsRepository,
  SmsSender,
  UserRepository,
  UserSearchQuery,
} from '../../ports.js';
import { ACTIVE_RESERVATION_STATUSES } from '@benzin/shared';
import { MemoryConversationRepository, MemoryMessageRepository } from './chat.js';
import {
  MemoryPaymentCardRepository,
  MemoryPaymentRepository,
  MemoryPlanRepository,
  MemorySubscriptionRepository,
} from './billing.js';
import { MemoryReputationRepository } from './reputation.js';
import { MemoryNotificationRepository } from './notifications.js';
import { MemoryZoneRepository } from './zones.js';

/**
 * In-memory repositories. They exist for unit/e2e tests and for `pnpm dev` without Docker.
 * The API refuses to boot on them when NODE_ENV=production. Every mutating method that the
 * domain relies on for correctness (order transition, reservation creation) is atomic here,
 * because JavaScript runs the critical section to completion without interleaving.
 */

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private byPhone = new Map<string, string>();

  async findById(id: string): Promise<User | null> {
    const user = this.byId.get(id);
    return user ? clone(user) : null;
  }

  async findByPhone(phone: string): Promise<User | null> {
    const id = this.byPhone.get(phone);
    return id ? this.findById(id) : null;
  }

  async create(input: NewUser): Promise<User> {
    const user: User = {
      id: randomUUID(),
      phone: input.phone,
      displayName: null,
      role: input.role ?? 'USER',
      status: 'ACTIVE',
      suspendedUntil: null,
      createdAt: new Date(),
    };
    this.byId.set(user.id, clone(user));
    this.byPhone.set(user.phone, user.id);
    return user;
  }

  async save(user: User): Promise<User> {
    this.byId.set(user.id, clone(user));
    this.byPhone.set(user.phone, user.id);
    return clone(user);
  }

  async list(limit: number): Promise<User[]> {
    return [...this.byId.values()].slice(0, limit).map(clone);
  }

  async search(query: UserSearchQuery): Promise<{ items: User[]; total: number }> {
    const text = query.text?.trim() ?? '';
    const matches = [...this.byId.values()]
      .filter((user) => (query.role === null ? true : user.role === query.role))
      .filter((user) => (query.status === null ? true : user.status === query.status))
      .filter(
        (user) =>
          text.length === 0 || user.phone.includes(text) || (user.displayName ?? '').includes(text),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: matches.slice(query.offset, query.offset + query.limit).map(clone),
      total: matches.length,
    };
  }

  async countByStatus(): Promise<Record<User['status'], number>> {
    const counts = { ACTIVE: 0, SUSPENDED: 0, BANNED: 0 } as Record<User['status'], number>;
    for (const user of this.byId.values()) counts[user.status] += 1;
    return counts;
  }

  async listSuspendedDue(now: Date, limit: number): Promise<User[]> {
    return [...this.byId.values()]
      .filter(
        (user) =>
          user.status === 'SUSPENDED' &&
          user.suspendedUntil !== null &&
          user.suspendedUntil.getTime() <= now.getTime(),
      )
      .slice(0, limit)
      .map(clone);
  }
}

export class MemoryOtpRepository implements OtpRepository {
  private readonly byPhone = new Map<string, OtpChallenge>();

  async findLatest(phone: string): Promise<OtpChallenge | null> {
    const challenge = this.byPhone.get(phone);
    return challenge ? clone(challenge) : null;
  }

  async save(challenge: OtpChallenge): Promise<void> {
    this.byPhone.set(challenge.phone, clone(challenge));
  }
}

export class MemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byId = new Map<string, RefreshTokenRecord>();

  async create(input: NewRefreshToken): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      deviceId: input.deviceId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedBy: null,
      createdAt: new Date(),
    };
    this.byId.set(record.id, clone(record));
    return clone(record);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.byId.values()) {
      if (record.tokenHash === tokenHash) return clone(record);
    }
    return null;
  }

  async revoke(id: string, replacedBy: string | null, at: Date): Promise<void> {
    const record = this.byId.get(id);
    if (record) this.byId.set(id, { ...record, revokedAt: at, replacedBy });
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const [id, record] of this.byId) {
      if (record.familyId === familyId && record.revokedAt === null) {
        this.byId.set(id, { ...record, revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const [id, record] of this.byId) {
      if (record.userId === userId && record.revokedAt === null) {
        this.byId.set(id, { ...record, revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
  }

  async countActive(userId: string): Promise<number> {
    return [...this.byId.values()].filter((r) => r.userId === userId && r.revokedAt === null)
      .length;
  }
}

export class MemoryDeviceRepository implements DeviceRepository {
  private readonly byId = new Map<string, DeviceRecord>();

  async upsert(input: DeviceInput, at: Date): Promise<DeviceRecord> {
    for (const [id, device] of this.byId) {
      if (device.userId === input.userId && device.deviceId === input.deviceId) {
        const updated: DeviceRecord = {
          ...device,
          platform: input.platform,
          pushToken: input.pushToken ?? device.pushToken,
          appVersion: input.appVersion ?? device.appVersion,
          lastSeenAt: at,
        };
        this.byId.set(id, clone(updated));
        return updated;
      }
    }
    const created: DeviceRecord = {
      id: randomUUID(),
      userId: input.userId,
      deviceId: input.deviceId,
      platform: input.platform,
      pushToken: input.pushToken ?? null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: at,
      createdAt: at,
    };
    this.byId.set(created.id, clone(created));
    return created;
  }

  async listByUser(userId: string): Promise<DeviceRecord[]> {
    return [...this.byId.values()].filter((d) => d.userId === userId).map(clone);
  }
}

export class MemoryOrderRepository implements OrderRepository {
  private readonly byId = new Map<string, Order>();

  async create(input: NewOrder): Promise<Order> {
    const now = new Date();
    const order: Order = {
      id: randomUUID(),
      ownerId: input.ownerId,
      side: input.side,
      tier: input.tier,
      litres: input.litres,
      rateToman: input.rateToman,
      zoneId: input.zoneId,
      stationName: input.stationName,
      note: input.note,
      lat: input.lat,
      lng: input.lng,
      deliveryMethod: input.deliveryMethod,
      status: 'OPEN',
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(order.id, clone(order));
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    const order = this.byId.get(id);
    return order ? clone(order) : null;
  }

  async search(query: OrderSearchQuery): Promise<{ items: Order[]; total: number }> {
    const matches = [...this.byId.values()].filter(
      (order) =>
        order.status === 'OPEN' &&
        order.zoneId === query.zoneId &&
        order.side === query.side &&
        order.tier === query.tier &&
        order.expiresAt.getTime() > query.now.getTime(),
    );

    const withDistance = matches.map((order) => {
      if (!query.origin || order.lat === null || order.lng === null) return { order, km: Infinity };
      return { order, km: haversineKm(query.origin!, { lat: order.lat, lng: order.lng }) };
    });

    const filtered =
      query.origin && query.radiusKm !== null
        ? withDistance.filter((entry) => entry.km <= query.radiusKm!)
        : withDistance;

    filtered.sort((a, b) => {
      if (query.sort === 'price') return a.order.rateToman - b.order.rateToman;
      if (query.sort === 'newest') return b.order.createdAt.getTime() - a.order.createdAt.getTime();
      return a.km - b.km;
    });

    return {
      items: filtered.slice(query.offset, query.offset + query.limit).map((e) => clone(e.order)),
      total: filtered.length,
    };
  }

  async listByOwner(ownerId: string, limit: number): Promise<Order[]> {
    return [...this.byId.values()]
      .filter((order) => order.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async countOpenByOwner(ownerId: string, now: Date): Promise<number> {
    return [...this.byId.values()].filter(
      (order) =>
        order.ownerId === ownerId &&
        (order.status === 'OPEN' || order.status === 'RESERVED') &&
        order.expiresAt.getTime() > now.getTime(),
    ).length;
  }

  async transition(
    id: string,
    expected: Order['status'],
    next: Order['status'],
    patch?: Partial<Pick<Order, 'updatedAt'>>,
  ): Promise<Order | null> {
    const current = this.byId.get(id);
    if (!current || current.status !== expected) return null;
    const updated: Order = { ...current, status: next, updatedAt: patch?.updatedAt ?? new Date() };
    this.byId.set(id, clone(updated));
    return clone(updated);
  }

  async listExpired(now: Date, limit: number): Promise<Order[]> {
    return [...this.byId.values()]
      .filter((order) => order.status === 'OPEN' && order.expiresAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async update(
    id: string,
    patch: Partial<Pick<Order, 'litres' | 'rateToman' | 'stationName' | 'note'>>,
    at: Date,
  ): Promise<Order | null> {
    const current = this.byId.get(id);
    if (!current) return null;
    const updated: Order = { ...current, ...patch, updatedAt: at };
    this.byId.set(id, clone(updated));
    return clone(updated);
  }

  async listAll(query: {
    status: Order['status'] | null;
    zoneId: string | null;
    side: Order['side'] | null;
    text: string | null;
    limit: number;
    offset: number;
  }): Promise<{ items: Order[]; total: number }> {
    const text = query.text?.trim() ?? '';
    const matches = [...this.byId.values()]
      .filter((order) => (query.status === null ? true : order.status === query.status))
      .filter((order) => (query.zoneId === null ? true : order.zoneId === query.zoneId))
      .filter((order) => (query.side === null ? true : order.side === query.side))
      .filter(
        (order) =>
          text.length === 0 || order.id.includes(text) || (order.stationName ?? '').includes(text),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: matches.slice(query.offset, query.offset + query.limit).map(clone),
      total: matches.length,
    };
  }

  async countByStatus(): Promise<Record<Order['status'], number>> {
    const counts: Record<Order['status'], number> = {
      OPEN: 0,
      RESERVED: 0,
      CONFIRMED: 0,
      AWAITING_OWNER_DECISION: 0,
      DISPUTED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    };
    for (const order of this.byId.values()) counts[order.status] += 1;
    return counts;
  }

  async listSince(zoneId: string, since: Date, limit: number): Promise<Order[]> {
    return [...this.byId.values()]
      .filter((order) => order.zoneId === zoneId && order.createdAt.getTime() >= since.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }
}

export class MemoryReservationRepository implements ReservationRepository {
  private readonly byId = new Map<string, Reservation>();

  private isActive(reservation: Reservation): boolean {
    return ACTIVE_RESERVATION_STATUSES.includes(reservation.status);
  }

  async findById(id: string): Promise<Reservation | null> {
    const reservation = this.byId.get(id);
    return reservation ? clone(reservation) : null;
  }

  async findActiveByOrder(orderId: string): Promise<Reservation | null> {
    for (const reservation of this.byId.values()) {
      if (reservation.orderId === orderId && this.isActive(reservation)) return clone(reservation);
    }
    return null;
  }

  async findActiveByTaker(takerId: string): Promise<Reservation[]> {
    return [...this.byId.values()]
      .filter((reservation) => reservation.takerId === takerId && this.isActive(reservation))
      .map(clone);
  }

  async countActiveByTaker(takerId: string): Promise<number> {
    return (await this.findActiveByTaker(takerId)).length;
  }

  async listByTaker(takerId: string, limit: number): Promise<Reservation[]> {
    return [...this.byId.values()]
      .filter((reservation) => reservation.takerId === takerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async createExclusive(input: NewReservation): Promise<Reservation | null> {
    // Critical section: no await between the check and the insert.
    if (await this.findActiveByOrder(input.orderId)) return null;
    const reservation: Reservation = {
      id: input.id,
      orderId: input.orderId,
      takerId: input.takerId,
      status: 'PENDING_OWNER',
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      decidedAt: null,
      completedAt: null,
      cancelReason: null,
    };
    this.byId.set(reservation.id, clone(reservation));
    return clone(reservation);
  }

  async transition(
    id: string,
    expected: Reservation['status'],
    next: Reservation['status'],
    patch?: Partial<Pick<Reservation, 'decidedAt' | 'completedAt' | 'cancelReason'>>,
  ): Promise<Reservation | null> {
    const current = this.byId.get(id);
    if (!current || current.status !== expected) return null;
    const updated: Reservation = { ...current, ...patch, status: next };
    this.byId.set(id, clone(updated));
    return clone(updated);
  }

  async listExpiredPending(now: Date, limit: number): Promise<Reservation[]> {
    return [...this.byId.values()]
      .filter((r) => r.status === 'PENDING_OWNER' && r.expiresAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async listByOrder(orderId: string, limit: number): Promise<Reservation[]> {
    return [...this.byId.values()]
      .filter((reservation) => reservation.orderId === orderId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async countActive(): Promise<number> {
    return [...this.byId.values()].filter((reservation) => this.isActive(reservation)).length;
  }

  async listAll(limit: number): Promise<Reservation[]> {
    return [...this.byId.values()].slice(0, limit).map(clone);
  }
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly byKey = new Map<string, SettingsRecord>();

  async findAll(): Promise<SettingsRecord[]> {
    return [...this.byKey.values()].map(clone);
  }

  async set(key: string, value: unknown, updatedBy: string | null): Promise<SettingsRecord> {
    const record: SettingsRecord = { key, value, updatedAt: new Date(), updatedBy };
    this.byKey.set(key, clone(record));
    return record;
  }
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditEntry[] = [];

  async append(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry> {
    const stored: AuditEntry = { ...entry, id: randomUUID(), createdAt: new Date() };
    this.entries.unshift(stored);
    return clone(stored);
  }

  async list(limit: number): Promise<AuditEntry[]> {
    return this.entries.slice(0, limit).map(clone);
  }

  async query(input: AuditQuery): Promise<{ items: AuditEntry[]; total: number }> {
    const matches = this.entries
      .filter((entry) => input.action === null || entry.action.startsWith(input.action))
      .filter((entry) => input.actorId === null || entry.actorId === input.actorId)
      .filter((entry) => input.entity === null || entry.entity === input.entity);
    return {
      items: matches.slice(input.offset, input.offset + input.limit).map(clone),
      total: matches.length,
    };
  }
}

/** Provider credentials edited from the panel; secrets are masked by the HTTP view. */
export class MemoryProviderSettingsRepository implements ProviderSettingsRepository {
  private readonly byId = new Map<string, ProviderSetting>();

  async list(): Promise<ProviderSetting[]> {
    return [...this.byId.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.provider.localeCompare(b.provider))
      .map(clone);
  }

  async findBy(kind: ProviderSetting['kind'], provider: string): Promise<ProviderSetting | null> {
    const found = [...this.byId.values()].find(
      (setting) => setting.kind === kind && setting.provider === provider,
    );
    return found ? clone(found) : null;
  }

  async upsert(
    input: Omit<ProviderSetting, 'id' | 'updatedAt'> & { id?: string },
    at: Date,
  ): Promise<ProviderSetting> {
    const existing = await this.findBy(input.kind, input.provider);
    const stored: ProviderSetting = {
      id: existing?.id ?? input.id ?? randomUUID(),
      provider: input.provider,
      kind: input.kind,
      config: input.config,
      isActive: input.isActive,
      updatedBy: input.updatedBy,
      updatedAt: at,
    };
    this.byId.set(stored.id, clone(stored));
    return clone(stored);
  }
}

/** Development SMS sender: writes to the log so the OTP is visible without an account. */
export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly logger: (message: string) => void = (m) => console.info(m)) {}

  async send(phone: string, message: string): Promise<void> {
    this.logger(`[sms] → ${phone}: ${message}`);
  }
}

export function createMemoryRepositories(): Repositories {
  const orders = new MemoryOrderRepository();
  const reservations = new MemoryReservationRepository();
  return {
    users: new MemoryUserRepository(),
    conversations: new MemoryConversationRepository(orders, reservations),
    messages: new MemoryMessageRepository(),
    notifications: new MemoryNotificationRepository(),
    reputation: new MemoryReputationRepository(),
    plans: new MemoryPlanRepository(),
    subscriptions: new MemorySubscriptionRepository(),
    payments: new MemoryPaymentRepository(),
    paymentCards: new MemoryPaymentCardRepository(),
    providerSettings: new MemoryProviderSettingsRepository(),
    otps: new MemoryOtpRepository(),
    refreshTokens: new MemoryRefreshTokenRepository(),
    devices: new MemoryDeviceRepository(),
    orders,
    reservations,
    settings: new MemorySettingsRepository(),
    zones: new MemoryZoneRepository(),
    audit: new MemoryAuditRepository(),
  };
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
