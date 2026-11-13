import {
  AppError,
  nextOrderStatus,
  nextReservationStatus,
  type CancelReason,
} from '@benzin/shared';
import type { Clock, Order, Reservation, User } from '../domain/entities.js';
import type { Repositories } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface ReservationView {
  id: string;
  orderId: string;
  takerId: string;
  status: Reservation['status'];
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
}

export const toReservationView = (reservation: Reservation): ReservationView => ({
  id: reservation.id,
  orderId: reservation.orderId,
  takerId: reservation.takerId,
  status: reservation.status,
  createdAt: reservation.createdAt.toISOString(),
  expiresAt: reservation.expiresAt.toISOString(),
  decidedAt: reservation.decidedAt?.toISOString() ?? null,
  completedAt: reservation.completedAt?.toISOString() ?? null,
  cancelReason: reservation.cancelReason,
});

export class ReservationService {
  constructor(
    private readonly repos: Pick<Repositories, 'orders' | 'reservations' | 'audit'>,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  private async load(id: string): Promise<{ reservation: Reservation; order: Order }> {
    const reservation = await this.repos.reservations.findById(id);
    if (!reservation) throw AppError.notFound('RESERVATION_NOT_FOUND', 'Reservation not found');
    const order = await this.repos.orders.findById(reservation.orderId);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    return { reservation, order };
  }

  /**
   * Requests an order. Two guards make this safe under concurrency:
   * the order status compare-and-set, and the single-active-reservation constraint.
   */
  async request(taker: User, orderId: string): Promise<ReservationView> {
    const config = await this.settings.get();
    const now = this.clock.now();
    const order = await this.repos.orders.findById(orderId);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');
    if (order.ownerId === taker.id) {
      throw AppError.forbidden('TRADE_CYCLE_BLOCKED', 'You cannot reserve your own order');
    }
    if (order.status !== 'OPEN' || order.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('ORDER_NOT_AVAILABLE', 409, 'Order is no longer available');
    }

    const active = await this.repos.reservations.findActiveByTaker(taker.id);
    if (active.length >= config['reservation.max_active_per_user']) {
      throw new AppError(
        'RESERVATION_LIMIT_REACHED',
        429,
        'You already have an active reservation',
        {
          limit: config['reservation.max_active_per_user'],
        },
      );
    }

    const reserved = await this.repos.orders.transition(orderId, 'OPEN', 'RESERVED');
    if (!reserved) throw new AppError('ORDER_NOT_AVAILABLE', 409, 'Order is no longer available');

    const reservation = await this.repos.reservations.createExclusive({
      id: crypto.randomUUID(),
      orderId,
      takerId: taker.id,
      expiresAt: new Date(now.getTime() + config['owner.decision_ttl_minutes'] * 60_000),
    });

    if (!reservation) {
      await this.repos.orders.transition(orderId, 'RESERVED', 'OPEN');
      throw new AppError('ORDER_NOT_AVAILABLE', 409, 'Order is no longer available');
    }

    await this.repos.audit.append({
      actorId: taker.id,
      action: 'reservation.requested',
      entity: 'reservation',
      entityId: reservation.id,
      metadata: { orderId },
    });
    return toReservationView(reservation);
  }

  async get(user: User, id: string): Promise<ReservationView> {
    const { reservation, order } = await this.load(id);
    if (reservation.takerId !== user.id && order.ownerId !== user.id && user.role === 'USER') {
      throw AppError.forbidden('NOT_RESERVATION_PARTY', 'Not a party to this reservation');
    }
    return toReservationView(reservation);
  }

  async confirm(actor: User, id: string): Promise<ReservationView> {
    const { reservation, order } = await this.load(id);
    if (order.ownerId !== actor.id) {
      throw AppError.forbidden('NOT_ORDER_OWNER', 'Only the order owner can accept');
    }
    if (reservation.status !== 'PENDING_OWNER') {
      throw new AppError('ALREADY_DECIDED', 409, `Reservation is ${reservation.status}`);
    }
    const now = this.clock.now();
    if (reservation.expiresAt.getTime() <= now.getTime()) {
      await this.expireOne(reservation, order);
      throw new AppError('RESERVATION_NOT_ACTIVE', 409, 'Reservation expired');
    }

    const next = nextReservationStatus(reservation.status, 'CONFIRM', 'OWNER');
    const updated = await this.repos.reservations.transition(id, reservation.status, next, {
      decidedAt: now,
    });
    if (!updated) throw AppError.conflict('CONFLICT', 'Reservation changed while accepting');

    const orderNext = nextOrderStatus(order.status, 'CONFIRM', 'OWNER');
    const updatedOrder = await this.repos.orders.transition(order.id, order.status, orderNext);
    if (!updatedOrder) throw AppError.conflict('CONFLICT', 'Order changed while accepting');

    await this.repos.audit.append({
      actorId: actor.id,
      action: 'reservation.confirmed',
      entity: 'reservation',
      entityId: id,
      metadata: { orderId: order.id },
    });
    return toReservationView(updated);
  }

  async reject(actor: User, id: string): Promise<ReservationView> {
    const { reservation, order } = await this.load(id);
    if (order.ownerId !== actor.id) {
      throw AppError.forbidden('NOT_ORDER_OWNER', 'Only the order owner can reject');
    }
    const next = nextReservationStatus(reservation.status, 'REJECT', 'OWNER');
    const updated = await this.repos.reservations.transition(id, reservation.status, next, {
      decidedAt: this.clock.now(),
    });
    if (!updated) throw AppError.conflict('CONFLICT', 'Reservation changed while rejecting');
    await this.repos.orders.transition(order.id, 'RESERVED', 'OPEN');
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'reservation.rejected',
      entity: 'reservation',
      entityId: id,
      metadata: {},
    });
    return toReservationView(updated);
  }

  async cancel(actor: User, id: string, reason: CancelReason): Promise<ReservationView> {
    const { reservation, order } = await this.load(id);
    const isOwner = order.ownerId === actor.id;
    const isTaker = reservation.takerId === actor.id;
    if (!isOwner && !isTaker) throw AppError.forbidden('NOT_RESERVATION_PARTY', 'Not a party');

    const actorKind = isOwner ? 'OWNER' : 'TAKER';
    if (isOwner && reservation.status === 'PENDING_OWNER') {
      // Cancelling a pending request is the same domain event as rejecting it.
      return this.reject(actor, id);
    }
    const event = actorKind === 'OWNER' ? 'CANCEL_OWNER' : 'CANCEL_TAKER';
    const next = nextReservationStatus(reservation.status, event, actorKind);
    const updated = await this.repos.reservations.transition(id, reservation.status, next, {
      decidedAt: reservation.decidedAt ?? this.clock.now(),
      cancelReason: reason,
    });
    if (!updated) throw AppError.conflict('CONFLICT', 'Reservation changed while cancelling');
    await this.repos.orders.transition(order.id, order.status, 'OPEN');
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'reservation.cancelled',
      entity: 'reservation',
      entityId: id,
      metadata: { reason, by: actorKind },
    });
    return toReservationView(updated);
  }

  async complete(actor: User, id: string): Promise<ReservationView> {
    const { reservation, order } = await this.load(id);
    if (reservation.takerId !== actor.id && order.ownerId !== actor.id) {
      throw AppError.forbidden('NOT_RESERVATION_PARTY', 'Not a party');
    }
    const actorKind = reservation.takerId === actor.id ? 'TAKER' : 'OWNER';
    const next = nextReservationStatus(reservation.status, 'COMPLETE', actorKind);
    const now = this.clock.now();
    const updated = await this.repos.reservations.transition(id, reservation.status, next, {
      completedAt: now,
    });
    if (!updated) throw AppError.conflict('CONFLICT', 'Reservation changed while completing');
    await this.repos.orders.transition(order.id, 'CONFIRMED', 'COMPLETED');
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'reservation.completed',
      entity: 'reservation',
      entityId: id,
      metadata: { by: actorKind },
    });
    return toReservationView(updated);
  }

  async listMine(user: User, limit = 20): Promise<ReservationView[]> {
    const reservations = await this.repos.reservations.listByTaker(user.id, limit);
    return reservations.map(toReservationView);
  }

  private async expireOne(reservation: Reservation, order: Order): Promise<void> {
    const expired = await this.repos.reservations.transition(
      reservation.id,
      'PENDING_OWNER',
      'EXPIRED',
    );
    if (expired) await this.repos.orders.transition(order.id, 'RESERVED', 'OPEN');
  }

  /** Releases orders whose owner-decision window elapsed. Called by the scheduler. */
  async expireDueReservations(limit = 200): Promise<number> {
    const due = await this.repos.reservations.listExpiredPending(this.clock.now(), limit);
    let count = 0;
    for (const reservation of due) {
      const order = await this.repos.orders.findById(reservation.orderId);
      if (!order) continue;
      await this.expireOne(reservation, order);
      count += 1;
    }
    return count;
  }
}
