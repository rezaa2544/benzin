import {
  AppError,
  TIER_RATE_TOMAN,
  type CreateOrderInput,
  type OrderSearchInput,
  type OrderStatus,
} from '@benzin/shared';
import type { Clock, Order, User } from '../domain/entities.js';
import { buyerSavingToman, isAboveOfficialRate, orderTotalToman } from '../domain/pricing.js';
import type { Repositories } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface OrderView {
  id: string;
  ownerId: string;
  side: Order['side'];
  tier: Order['tier'];
  litres: number;
  rateToman: number;
  officialRateToman: number;
  totalToman: number;
  buyerSavingToman: number;
  status: OrderStatus;
  stationName: string | null;
  note: string | null;
  location: { lat: number; lng: number } | null;
  deliveryMethod: Order['deliveryMethod'];
  expiresAt: string;
  createdAt: string;
}

export function toOrderView(order: Order): OrderView {
  return {
    id: order.id,
    ownerId: order.ownerId,
    side: order.side,
    tier: order.tier,
    litres: order.litres,
    rateToman: order.rateToman,
    officialRateToman: TIER_RATE_TOMAN[order.tier],
    totalToman: orderTotalToman(order.litres, order.rateToman),
    buyerSavingToman: buyerSavingToman(order.tier, order.litres, order.rateToman),
    status: order.status,
    stationName: order.stationName,
    note: order.note,
    location: order.lat !== null && order.lng !== null ? { lat: order.lat, lng: order.lng } : null,
    deliveryMethod: order.deliveryMethod,
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
  };
}

const encodeCursor = (offset: number): string => Buffer.from(String(offset)).toString('base64url');
const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d{1,9}$/.test(decoded)) throw AppError.validation('Invalid cursor');
  return Number(decoded);
};

export class OrderService {
  constructor(
    private readonly repos: Pick<Repositories, 'orders' | 'audit' | 'zones'>,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async create(user: User, input: CreateOrderInput): Promise<OrderView> {
    const config = await this.settings.get();
    const now = this.clock.now();

    if (input.litres < config['order.min_litres'] || input.litres > config['order.max_litres']) {
      throw AppError.validation('Litres outside the allowed range', {
        min: config['order.min_litres'],
        max: config['order.max_litres'],
      });
    }
    if (isAboveOfficialRate(input.tier, input.rateToman)) {
      throw AppError.validation('Price cannot exceed the official rate for this tier', {
        officialRateToman: TIER_RATE_TOMAN[input.tier],
      });
    }
    const zone = await this.repos.zones.findById(input.zoneId);
    if (!zone || !zone.isActive) {
      throw new AppError('ZONE_NOT_SUPPORTED', 422, 'Zone is not served yet', {
        zoneId: input.zoneId,
      });
    }

    const openOrders = await this.repos.orders.countOpenByOwner(user.id, now);
    if (openOrders >= config['order.max_open_per_user']) {
      throw new AppError('ORDER_LIMIT_REACHED', 429, 'Too many open orders', {
        limit: config['order.max_open_per_user'],
      });
    }

    const order = await this.repos.orders.create({
      ownerId: user.id,
      side: input.side,
      tier: input.tier,
      litres: input.litres,
      rateToman: input.rateToman,
      zoneId: input.zoneId,
      stationName: input.stationName ?? null,
      note: input.note ?? null,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      deliveryMethod: input.deliveryMethod,
      expiresAt: new Date(now.getTime() + config['order.default_expiry_hours'] * 3_600_000),
    });

    await this.repos.audit.append({
      actorId: user.id,
      action: 'order.created',
      entity: 'order',
      entityId: order.id,
      metadata: {
        side: order.side,
        tier: order.tier,
        litres: order.litres,
        rateToman: order.rateToman,
      },
    });
    return toOrderView(order);
  }

  async search(
    query: OrderSearchInput,
  ): Promise<{ items: OrderView[]; nextCursor: string | null }> {
    const offset = decodeCursor(query.cursor);
    const { items, total } = await this.repos.orders.search({
      zoneId: query.zoneId,
      side: query.side,
      tier: query.tier,
      now: this.clock.now(),
      limit: query.limit,
      offset,
      sort: query.sort,
      origin:
        query.lat !== undefined && query.lng !== undefined
          ? { lat: query.lat, lng: query.lng }
          : null,
      radiusKm: query.radiusKm ?? null,
    });
    const nextOffset = offset + items.length;
    return {
      items: items.map(toOrderView),
      nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
    };
  }

  async getById(id: string): Promise<OrderView> {
    const order = await this.repos.orders.findById(id);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    return toOrderView(order);
  }

  async listMine(user: User, limit = 20): Promise<OrderView[]> {
    const orders = await this.repos.orders.listByOwner(user.id, limit);
    return orders.map(toOrderView);
  }

  async cancel(user: User, id: string): Promise<OrderView> {
    const order = await this.repos.orders.findById(id);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    if (order.ownerId !== user.id)
      throw AppError.forbidden('NOT_ORDER_OWNER', 'Only the owner can cancel');
    if (order.status !== 'OPEN' && order.status !== 'RESERVED') {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        409,
        `Cannot cancel an order that is ${order.status}`,
      );
    }
    const updated = await this.repos.orders.transition(id, order.status, 'CANCELLED');
    if (!updated) throw AppError.conflict('CONFLICT', 'Order changed while cancelling');
    await this.repos.audit.append({
      actorId: user.id,
      action: 'order.cancelled',
      entity: 'order',
      entityId: id,
      metadata: { from: order.status },
    });
    return toOrderView(updated);
  }

  /** Marks open orders past their expiry. Invoked by the scheduler every minute. */
  async expireDueOrders(limit = 200): Promise<number> {
    const now = this.clock.now();
    const due = await this.repos.orders.listExpired(now, limit);
    let expired = 0;
    for (const order of due) {
      const updated = await this.repos.orders.transition(order.id, 'OPEN', 'EXPIRED');
      if (updated) expired += 1;
    }
    return expired;
  }
}
