import { AppError } from './errors.js';
import type { OrderStatus, ReservationStatus } from './enums.js';

export type Actor = 'OWNER' | 'TAKER' | 'SYSTEM' | 'ADMIN';

interface Transition<S extends string, E extends string> {
  readonly from: S;
  readonly event: E;
  readonly to: S;
  readonly actors: readonly Actor[];
}

export type OrderEvent =
  | 'RESERVE'
  | 'CONFIRM'
  | 'COMPLETE'
  | 'RELEASE'
  | 'EXPIRE'
  | 'CANCEL'
  | 'OWNER_UNRESPONSIVE'
  | 'DISPUTE'
  | 'RESOLVE_COMPLETE'
  | 'RESOLVE_CANCEL';

const ALL_ACTORS: readonly Actor[] = ['OWNER', 'TAKER', 'SYSTEM', 'ADMIN'];

/** §6 order state machine. `OPEN → RESERVED → CONFIRMED → COMPLETED` plus terminal escapes. */
export const ORDER_TRANSITIONS: readonly Transition<OrderStatus, OrderEvent>[] = [
  { from: 'OPEN', event: 'RESERVE', to: 'RESERVED', actors: ['TAKER', 'SYSTEM'] },
  { from: 'RESERVED', event: 'CONFIRM', to: 'CONFIRMED', actors: ['OWNER'] },
  { from: 'RESERVED', event: 'RELEASE', to: 'OPEN', actors: ['SYSTEM', 'TAKER', 'OWNER', 'ADMIN'] },
  {
    from: 'CONFIRMED',
    event: 'COMPLETE',
    to: 'COMPLETED',
    actors: ['OWNER', 'TAKER', 'SYSTEM', 'ADMIN'],
  },
  { from: 'OPEN', event: 'EXPIRE', to: 'EXPIRED', actors: ['SYSTEM', 'OWNER', 'ADMIN'] },
  { from: 'OPEN', event: 'CANCEL', to: 'CANCELLED', actors: ['OWNER', 'ADMIN'] },
  { from: 'RESERVED', event: 'CANCEL', to: 'CANCELLED', actors: ['OWNER', 'ADMIN'] },
  {
    from: 'CONFIRMED',
    event: 'OWNER_UNRESPONSIVE',
    to: 'AWAITING_OWNER_DECISION',
    actors: ['SYSTEM', 'TAKER'],
  },
  { from: 'CONFIRMED', event: 'DISPUTE', to: 'DISPUTED', actors: ALL_ACTORS },
  {
    from: 'AWAITING_OWNER_DECISION',
    event: 'RELEASE',
    to: 'OPEN',
    actors: ['OWNER', 'SYSTEM', 'ADMIN'],
  },
  {
    from: 'AWAITING_OWNER_DECISION',
    event: 'CANCEL',
    to: 'CANCELLED',
    actors: ['OWNER', 'SYSTEM', 'ADMIN'],
  },
  { from: 'DISPUTED', event: 'RESOLVE_COMPLETE', to: 'COMPLETED', actors: ['ADMIN'] },
  { from: 'DISPUTED', event: 'RESOLVE_CANCEL', to: 'CANCELLED', actors: ['ADMIN'] },
];

export type ReservationEvent =
  | 'CONFIRM'
  | 'REJECT'
  | 'COMPLETE'
  | 'AUTO_COMPLETE'
  | 'DISPUTE'
  | 'TIMEOUT'
  | 'CANCEL_TAKER'
  | 'CANCEL_OWNER'
  | 'CONTACT_WINDOW_ELAPSED'
  | 'RESOLVE_COMPLETE'
  | 'RESOLVE_CANCEL';

export const RESERVATION_TRANSITIONS: readonly Transition<ReservationStatus, ReservationEvent>[] = [
  { from: 'PENDING_OWNER', event: 'CONFIRM', to: 'CONFIRMED', actors: ['OWNER'] },
  { from: 'PENDING_OWNER', event: 'REJECT', to: 'REJECTED', actors: ['OWNER'] },
  { from: 'PENDING_OWNER', event: 'TIMEOUT', to: 'EXPIRED', actors: ['SYSTEM', 'OWNER', 'ADMIN'] },
  { from: 'PENDING_OWNER', event: 'CANCEL_TAKER', to: 'CANCELLED_BY_TAKER', actors: ['TAKER'] },
  { from: 'CONFIRMED', event: 'COMPLETE', to: 'COMPLETED', actors: ALL_ACTORS.slice(0, 3) },
  { from: 'CONFIRMED', event: 'AUTO_COMPLETE', to: 'AUTO_COMPLETED', actors: ['SYSTEM'] },
  { from: 'CONFIRMED', event: 'DISPUTE', to: 'DISPUTED', actors: ALL_ACTORS },
  {
    from: 'CONFIRMED',
    event: 'CONTACT_WINDOW_ELAPSED',
    to: 'EXPIRED',
    actors: ['SYSTEM', 'ADMIN'],
  },
  { from: 'CONFIRMED', event: 'CANCEL_TAKER', to: 'CANCELLED_BY_TAKER', actors: ['TAKER'] },
  { from: 'CONFIRMED', event: 'CANCEL_OWNER', to: 'CANCELLED_BY_OWNER', actors: ['OWNER'] },
  { from: 'DISPUTED', event: 'RESOLVE_COMPLETE', to: 'COMPLETED', actors: ['ADMIN'] },
  { from: 'DISPUTED', event: 'RESOLVE_CANCEL', to: 'CANCELLED_BY_OWNER', actors: ['ADMIN'] },
];

function findTransition<S extends string, E extends string>(
  transitions: readonly Transition<S, E>[],
  from: S,
  event: E,
): Transition<S, E> | undefined {
  return transitions.find((t) => t.from === from && t.event === event);
}

export function canOrderTransition(from: OrderStatus, event: OrderEvent, actor: Actor): boolean {
  const t = findTransition(ORDER_TRANSITIONS, from, event);
  return t !== undefined && t.actors.includes(actor);
}

export function nextOrderStatus(from: OrderStatus, event: OrderEvent, actor: Actor): OrderStatus {
  const t = findTransition(ORDER_TRANSITIONS, from, event);
  if (!t || !t.actors.includes(actor)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      409,
      `Order cannot handle ${event} from ${from} as ${actor}`,
      { from, event, actor },
    );
  }
  return t.to;
}

export function canReservationTransition(
  from: ReservationStatus,
  event: ReservationEvent,
  actor: Actor,
): boolean {
  const t = findTransition(RESERVATION_TRANSITIONS, from, event);
  return t !== undefined && t.actors.includes(actor);
}

export function nextReservationStatus(
  from: ReservationStatus,
  event: ReservationEvent,
  actor: Actor,
): ReservationStatus {
  const t = findTransition(RESERVATION_TRANSITIONS, from, event);
  if (!t || !t.actors.includes(actor)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      409,
      `Reservation cannot handle ${event} from ${from} as ${actor}`,
      { from, event, actor },
    );
  }
  return t.to;
}

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
];
export const TERMINAL_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'COMPLETED',
  'AUTO_COMPLETED',
  'EXPIRED',
  'CANCELLED_BY_TAKER',
  'CANCELLED_BY_OWNER',
  'REJECTED',
];
